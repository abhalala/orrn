/**
 * Artifact procedures (plan B5): begin, commitRaw, putRows, complete, list, get, period.confirm and
 * status. The browser reads the file; the server stores its digest, blocks and rows, and the bytes go
 * to the vault by signed PUT.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";

import {
  ingestArtifact,
  ingestBlock,
  ingestBotRun,
  ingestCandidate,
  ingestMergeRun,
  ingestStagedRow,
  type ArtifactKind,
  type IngestPeriodGuess,
} from "@orrn/db/schema/ingest";

import { auditInsert } from "../audit";
import { now } from "../clock";
import { createId } from "../id";
import { pushChunkedInserts, type SqliteBatchItem } from "../atomic";
import { shapeBot } from "./engines";
import {
  artifactSummary,
  blockView,
  candidateChange,
  decodeCursor,
  encodeCursor,
  guardedBatch,
  ingestAbortUnlessChanged,
  loadArtifact,
  loadBlock,
  summarize,
  type ArtifactRow,
} from "./core";
import { guessArtifactPeriod } from "./period";
import { canonicalKey, CANONICAL_MAX_BYTES, digestKey, ingestVault, issueTicket, rawKey, vaultReady } from "./vault";
import {
  INGEST_LIMITS,
  type ArtifactBeginOut,
  type ArtifactDetail,
  type ArtifactSummary,
  type IngestCtx,
  type IngestStatus,
  type Page,
} from "./types";

const OPEN_STATES_EXCLUDED = ["merged", "discarded"] as const;

function mb(n: number): number {
  return Math.round(n / 1024 / 1024);
}

/** Rows staged in candidates that are neither merged nor discarded (plan A9, 300,000 per plant). */
export async function openStagedRows(ctx: Pick<IngestCtx, "db" | "companyId">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`coalesce(sum(${ingestCandidate.rowsTotal}), 0)` })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), notInArray(ingestCandidate.state, [...OPEN_STATES_EXCLUDED])));
  return Number(row?.n ?? 0);
}

async function hexDigest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Plan B1: rowKey = hex sha256(artifactId|blockOrdinal|rowIndex). */
export function rowKeyOf(artifactId: string, blockOrdinal: number, rowIndex: number): Promise<string> {
  return hexDigest(`${artifactId}|${blockOrdinal}|${rowIndex}`);
}

/** Plan B1: staged row id = hex sha256(rowKey|target); "none" while the candidate has no target. */
export function stagedRowIdOf(rowKey: string, target: string | null): Promise<string> {
  return hexDigest(`${rowKey}|${target ?? "none"}`);
}

// ---------------------------------------------------------------------------
// begin / commitRaw
// ---------------------------------------------------------------------------

export async function beginArtifact(
  ctx: IngestCtx,
  input: { sha256: string; fileName: string; sizeBytes: number; contentType: string | null; kind: ArtifactKind; note?: string },
): Promise<ArtifactBeginOut> {
  const limit = INGEST_LIMITS.maxFileBytes[input.kind];
  if (input.sizeBytes > limit) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${input.fileName} is too big. The limit for this kind of file is ${mb(limit)} MB.` });
  }
  const ready = vaultReady();
  const ticketFor = (artifactId: string) =>
    issueTicket(ctx, {
      purpose: "ingest-raw",
      companyId: ctx.companyId,
      userId: ctx.session.user.id,
      artifactId,
      sha256: input.sha256,
      key: rawKey(ctx.companyId, input.sha256),
      size: input.sizeBytes,
      exactSize: true,
      contentType: input.contentType ?? "",
      fileName: input.fileName,
    });

  const [existing] = await ctx.db
    .select()
    .from(ingestArtifact)
    .where(and(eq(ingestArtifact.companyId, ctx.companyId), eq(ingestArtifact.sha256, input.sha256)))
    .limit(1);
  if (existing) {
    // The same bytes again: open the existing artifact. When its bytes are not in the vault yet and
    // the vault is ready now, hand out a ticket to attach them (plan A2, "No R2").
    let upload: ArtifactBeginOut["upload"] = null;
    if (existing.vaultState !== "stored" && ready && existing.sizeBytes === input.sizeBytes) {
      upload = await ticketFor(existing.id);
      if (existing.vaultState === "not_stored") {
        await ctx.db
          .update(ingestArtifact)
          .set({ vaultState: "pending" })
          .where(and(eq(ingestArtifact.id, existing.id), eq(ingestArtifact.companyId, ctx.companyId)));
      }
    }
    return { artifactId: existing.id, existing: true, uploadedAt: existing.createdAt.getTime(), upload };
  }

  if ((await openStagedRows(ctx)) >= INGEST_LIMITS.openRowsPerPlant) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Too many rows are waiting. Merge or discard older imports first." });
  }

  const id = createId();
  const at = now();
  try {
    await guardedBatch(ctx.db, [
      ctx.db.insert(ingestArtifact).values({
        id,
        companyId: ctx.companyId,
        sha256: input.sha256,
        fileName: input.fileName,
        contentType: input.contentType,
        kind: input.kind,
        sizeBytes: input.sizeBytes,
        vaultState: ready ? "pending" : "not_stored",
        readState: "reading",
        note: input.note?.trim() || null,
        uploadedBy: ctx.session.user.id,
        createdAt: at,
        updatedAt: at,
      }),
      auditInsert(ctx, {
        action: "ingest.artifact.upload",
        subjectType: "ingest_artifact",
        subjectId: id,
        meta: { fileName: input.fileName, sha256: input.sha256, sizeBytes: input.sizeBytes, kind: input.kind, stored: ready },
      }),
    ]);
  } catch (e) {
    // Two tabs began the same file at once: the unique (company, sha256) index lets one in.
    if (/UNIQUE constraint failed: ingest_artifact/.test(String((e as Error)?.message ?? e))) {
      return beginArtifact(ctx, input);
    }
    throw e;
  }
  return { artifactId: id, existing: false, uploadedAt: at.getTime(), upload: ready ? await ticketFor(id) : null };
}

/** After the PUT: the object must exist with the declared size. */
export async function commitRaw(ctx: IngestCtx, artifactId: string): Promise<{ vaultState: ArtifactSummary["vaultState"] }> {
  const a = await loadArtifact(ctx, artifactId);
  if (a.vaultState === "stored") return { vaultState: "stored" };
  const bucket = ingestVault();
  if (!bucket) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "File storage is not set up for this plant yet" });
  const head = await bucket.head(rawKey(ctx.companyId, a.sha256));
  if (!head) throw new TRPCError({ code: "BAD_REQUEST", message: "The file has not arrived yet. Try again." });
  if (head.size !== a.sizeBytes) throw new TRPCError({ code: "BAD_REQUEST", message: "The stored file size does not match" });
  await ctx.db
    .update(ingestArtifact)
    .set({ vaultState: "stored", updatedAt: now() })
    .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId)));
  return { vaultState: "stored" };
}

// ---------------------------------------------------------------------------
// putRows
// ---------------------------------------------------------------------------

/** Cut a row to the cell and row caps (A3, A9). Returns the cells and the reasons for any cut. */
export function capRow(cells: readonly string[]): { raw: string[]; reasons: string[] } {
  const reasons: string[] = [];
  let raw = cells.map((c) => (c.length > INGEST_LIMITS.cellChars ? (reasons.includes("cell_cut") || reasons.push("cell_cut"), c.slice(0, INGEST_LIMITS.cellChars)) : c));
  let bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
  if (bytes > INGEST_LIMITS.rawBytesPerRow) {
    reasons.push("row_cut");
    let cap: number = INGEST_LIMITS.cellChars;
    while (bytes > INGEST_LIMITS.rawBytesPerRow && cap > 0) {
      cap = Math.floor(cap * 0.75);
      raw = raw.map((c) => (c.length > cap ? c.slice(0, cap) : c));
      bytes = new TextEncoder().encode(JSON.stringify(raw)).length;
    }
  }
  return { raw, reasons };
}

export async function putRows(
  ctx: IngestCtx,
  input: { blockId: string; fromIndex: number; expectRowsPut: number; rows: string[][] },
): Promise<{ rowsPut: number }> {
  const block = await loadBlock(ctx, input.blockId);
  const artifact = await loadArtifact(ctx, block.artifactId);
  if (artifact.readState !== "reading") throw new TRPCError({ code: "BAD_REQUEST", message: "This file is already read" });
  if (input.fromIndex !== input.expectRowsPut || block.rowsPut !== input.expectRowsPut) {
    throw new TRPCError({ code: "CONFLICT", message: "Rows were sent from another tab. Reload and try again." });
  }
  const end = input.fromIndex + input.rows.length;
  if (end > block.rowCount || end > INGEST_LIMITS.stagedRowsPerBlock) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "More rows than the sheet said it has" });
  }
  const [primary] = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.blockId, block.id), sql`${ingestCandidate.parentId} is null`))
    .orderBy(asc(ingestCandidate.createdAt))
    .limit(1);
  if (!primary) throw new TRPCError({ code: "BAD_REQUEST", message: "Send the sheets before their rows" });
  if (primary.state === "discarded") return { rowsPut: block.rowsPut };

  const at = now();
  const rows = await Promise.all(
    input.rows.map(async (cells, i) => {
      const rowIndex = input.fromIndex + i;
      const rowKey = await rowKeyOf(artifact.id, block.ordinal, rowIndex);
      const { raw, reasons } = capRow(cells);
      return {
        id: await stagedRowIdOf(rowKey, primary.target),
        companyId: ctx.companyId,
        rowKey,
        candidateId: primary.id,
        rowIndex,
        raw,
        values: null,
        entered: null,
        state: "pending" as const,
        reasons: reasons.length ? reasons : null,
        matchId: null,
        diff: null,
        decision: null,
        mergeState: "open" as const,
        committedType: null,
        committedId: null,
        updatedAt: at,
      };
    }),
  );

  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(ingestBlock)
      .set({ rowsPut: end })
      .where(and(eq(ingestBlock.id, block.id), eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.rowsPut, input.expectRowsPut))),
    ingestAbortUnlessChanged(ctx.db),
  ];
  pushChunkedInserts(statements, (part) => ctx.db.insert(ingestStagedRow).values(part), rows);
  statements.push(
    ctx.db
      .update(ingestCandidate)
      .set({ rowsTotal: sql`${ingestCandidate.rowsTotal} + ${rows.length}`, updatedAt: at })
      .where(and(eq(ingestCandidate.id, primary.id), eq(ingestCandidate.companyId, ctx.companyId))),
  );
  await guardedBatch(ctx.db, statements, { code: "CONFLICT", message: "Rows were sent from another tab. Reload and try again." });
  return { rowsPut: end };
}

// ---------------------------------------------------------------------------
// complete
// ---------------------------------------------------------------------------

export async function completeArtifact(
  ctx: IngestCtx,
  input: { artifactId: string; readError?: string },
): Promise<{ canonicalUploads: { blockOrdinal: number; url: string; ticket: string }[] }> {
  const a = await loadArtifact(ctx, input.artifactId);
  const blocks = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id)))
    .orderBy(asc(ingestBlock.ordinal));
  const at = now();

  if (input.readError) {
    await guardedBatch(ctx.db, [
      ctx.db
        .update(ingestArtifact)
        .set({ readState: "failed", readError: input.readError, updatedAt: at })
        .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId), eq(ingestArtifact.readState, "reading"))),
      ingestAbortUnlessChanged(ctx.db),
      ctx.db
        .update(ingestCandidate)
        .set({ state: "failed", reasonCode: "read_failed", reasonDetail: input.readError, serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: at })
        .where(
          and(
            eq(ingestCandidate.companyId, ctx.companyId),
            eq(ingestCandidate.artifactId, a.id),
            inArray(ingestCandidate.state, ["processing", "needs_shape", "needs_confirm"]),
          ),
        ),
    ], { code: "BAD_REQUEST", message: "This file is already read" });
    return { canonicalUploads: [] };
  }

  if (a.readState === "reading") {
    const missing = blocks.filter((b) => b.rowsPut !== b.rowCount);
    if (missing.length > 0) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `Some rows were not sent yet (sheet ${missing[0]!.sheetName ?? missing[0]!.ordinal + 1})` });
    }
    const period = guessArtifactPeriod(a, blocks);
    const rowCount = blocks.reduce((n, b) => n + b.rowCount, 0);
    await ctx.db
      .update(ingestArtifact)
      .set({ readState: "read", period, rowCount, blockCount: blocks.length, updatedAt: at })
      .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId)));
    const bucket = ingestVault();
    if (bucket) {
      const digest = {
        v: 1,
        artifactId: a.id,
        sha256: a.sha256,
        fileName: a.fileName,
        kind: a.kind,
        rowCount,
        period,
        blocks: blocks.map((b) => ({
          ordinal: b.ordinal,
          sheetName: b.sheetName,
          title: b.title,
          headerRow: b.headerRow,
          headerRows: b.headerRows,
          headers: b.headers,
          kinds: b.kinds,
          headerKey: b.headerKey,
          rowCount: b.rowCount,
        })),
      };
      await bucket.put(digestKey(ctx.companyId, a.sha256), JSON.stringify(digest), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { companyId: ctx.companyId, artifactId: a.id },
      });
    }
  } else if (a.readState === "failed") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "This file could not be read." });
  }

  if (!vaultReady()) return { canonicalUploads: [] };
  const canonicalUploads = await Promise.all(
    blocks.map(async (b) => {
      const t = await issueTicket(ctx, {
        purpose: "ingest-canonical",
        companyId: ctx.companyId,
        userId: ctx.session.user.id,
        artifactId: a.id,
        sha256: a.sha256,
        key: canonicalKey(ctx.companyId, a.sha256, b.ordinal),
        size: CANONICAL_MAX_BYTES,
        exactSize: false,
        contentType: "application/gzip",
        fileName: `${b.ordinal}.jsonl.gz`,
      });
      return { blockOrdinal: b.ordinal, url: t.url, ticket: t.ticket };
    }),
  );
  return { canonicalUploads };
}

// ---------------------------------------------------------------------------
// list / get / period
// ---------------------------------------------------------------------------

export async function listArtifacts(ctx: IngestCtx, input: { cursor?: string; limit: number }): Promise<Page<ArtifactSummary>> {
  const c = decodeCursor(input.cursor);
  const where = and(
    eq(ingestArtifact.companyId, ctx.companyId),
    c
      ? or(
          lt(ingestArtifact.createdAt, new Date(c.at)),
          and(eq(ingestArtifact.createdAt, new Date(c.at)), lt(ingestArtifact.id, c.id)),
        )
      : undefined,
  );
  const rows = await ctx.db
    .select()
    .from(ingestArtifact)
    .where(where)
    .orderBy(desc(ingestArtifact.createdAt), desc(ingestArtifact.id))
    .limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  const last = page.at(-1);
  return { items: page.map(artifactSummary), nextCursor: rows.length > input.limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

export async function getArtifact(ctx: IngestCtx, artifactId: string): Promise<ArtifactDetail> {
  const a = await loadArtifact(ctx, artifactId);
  const blocks = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, a.id)))
    .orderBy(asc(ingestBlock.ordinal));
  const candidates = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, a.id)))
    .orderBy(asc(ingestCandidate.createdAt));
  const summaries = await summarize(ctx, candidates);
  return {
    ...artifactSummary(a),
    blocks: blocks.map((b) => ({ ...blockView(b), candidates: summaries.filter((s) => s.blockId === b.id) })),
  };
}

/**
 * Plan B8: the person confirms the financial year and the as-of date. For orders with no date column
 * the as-of date becomes `orderDate`; answering `period_needed` re-runs those rows.
 */
export async function confirmPeriod(
  ctx: IngestCtx,
  input: { artifactId: string; fy: string | null; asOf: string | null },
): Promise<ArtifactSummary> {
  const a = await loadArtifact(ctx, input.artifactId);
  if (input.fy && !validFy(input.fy)) throw new TRPCError({ code: "BAD_REQUEST", message: "Financial year looks like 2025-26" });
  if (input.asOf && !validDate(input.asOf)) throw new TRPCError({ code: "BAD_REQUEST", message: "Date looks like 2025-10-31" });
  if (input.fy && input.asOf && fyOfDate(input.asOf) !== input.fy) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${input.asOf} is not in financial year ${input.fy}` });
  }
  const at = now();
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(ingestArtifact)
      .set({ periodConfirmed: { fy: input.fy, asOf: input.asOf }, updatedAt: at })
      .where(and(eq(ingestArtifact.id, a.id), eq(ingestArtifact.companyId, ctx.companyId))),
  ];
  // Candidates of this file whose rows depend on the period go back to processing from the start.
  const affected = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.artifactId, a.id),
        inArray(ingestCandidate.state, ["processing", "ready", "held"]),
        eq(ingestCandidate.target, "orders"),
      ),
    );
  for (const c of affected) {
    if (c.recipeLocked) continue;
    statements.push(...candidateChange(ctx, c.id, c.serverSeq, { state: "processing", dryCursor: 0 }));
  }
  await guardedBatch(ctx.db, statements);
  return artifactSummary(await loadArtifact(ctx, a.id));
}

export function validFy(fy: string): boolean {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  return !!m && (Number(m[1]) + 1) % 100 === Number(m[2]);
}

export function validDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

/** April to March: 2025-10-31 is in 2025-26, 2026-02-01 too. */
export function fyOfDate(text: string): string {
  const y = Number(text.slice(0, 4));
  const m = Number(text.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

/** Midnight Asia/Kolkata (UTC+5:30, no daylight saving) at or before `at`. */
export function istMidnight(at: Date): Date {
  const offset = 330 * 60 * 1000;
  const local = at.getTime() + offset;
  return new Date(local - (local % 86_400_000) - offset);
}

export async function ingestStatus(ctx: IngestCtx): Promise<IngestStatus> {
  const [run] = await ctx.db
    .select({ id: ingestMergeRun.id })
    .from(ingestMergeRun)
    .where(and(eq(ingestMergeRun.companyId, ctx.companyId), inArray(ingestMergeRun.state, ["planning", "running"])))
    .limit(1);
  const [today] = await ctx.db
    .select({ calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${ingestBotRun.costMicroUsd}), 0)` })
    .from(ingestBotRun)
    .where(and(eq(ingestBotRun.companyId, ctx.companyId), gte(ingestBotRun.createdAt, istMidnight(now()))));
  return {
    botReady: shapeBot.botReady(),
    vaultReady: vaultReady(),
    limits: INGEST_LIMITS,
    activeRunId: run?.id ?? null,
    botToday: { calls: Number(today?.calls ?? 0), costMicroUsd: Number(today?.cost ?? 0) },
  };
}

export type { ArtifactRow, IngestPeriodGuess };
