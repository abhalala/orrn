/**
 * Artifact procedures (plan B5): begin, commitRaw, putRows, complete, list, get, period.confirm and
 * status. The browser reads the file; the server stores its digest, blocks and rows, and the bytes go
 * to the vault by signed PUT.
 */
import { periodRequired, recipeSchema } from "@orrn/ingest";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, lt, notInArray, or, sql } from "drizzle-orm";

import {
  ingestAnswer,
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
  blockViewFor,
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
  KEPT_UNREAD_NO_STORAGE,
  isKeptUnread,
  type ArtifactBeginOut,
  type ArtifactDetail,
  type ArtifactSummary,
  type IngestCtx,
  type IngestStatus,
  type Page,
  type DoubtCode,
  type RowDoubtView,
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
  // A PDF or photo is only kept in this release, so with no vault there is nothing to keep it in.
  const keptOnly = isKeptUnread(input.kind);
  if (keptOnly && !ready) throw new TRPCError({ code: "PRECONDITION_FAILED", message: KEPT_UNREAD_NO_STORAGE });
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
  if (existing && existing.sizeBytes === input.sizeBytes && !keptOnly && rereadable(existing)) {
    // A file whose read failed, or that gave no table (a scan or photo before the vision read), is read
    // again from the start. Its old sheets, candidates and rows go; the stored bytes stay (A4, A10).
    const at = now();
    const ofArtifact = sql`(select id from ingest_candidate where artifact_id = ${existing.id} and company_id = ${ctx.companyId})`;
    await guardedBatch(
      ctx.db,
      [
        ctx.db
          .update(ingestArtifact)
          .set({ readState: "reading", readError: null, rowCount: 0, blockCount: 0, period: null, updatedAt: at })
          .where(
            and(
              eq(ingestArtifact.id, existing.id),
              eq(ingestArtifact.companyId, ctx.companyId),
              eq(ingestArtifact.readState, existing.readState),
              eq(ingestArtifact.blockCount, existing.blockCount),
            ),
          ),
        ingestAbortUnlessChanged(ctx.db),
        ctx.db.delete(ingestStagedRow).where(and(eq(ingestStagedRow.companyId, ctx.companyId), sql`${ingestStagedRow.candidateId} in ${ofArtifact}`)),
        ctx.db.delete(ingestAnswer).where(and(eq(ingestAnswer.companyId, ctx.companyId), sql`${ingestAnswer.candidateId} in ${ofArtifact}`)),
        ctx.db.delete(ingestCandidate).where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.artifactId, existing.id))),
        ctx.db.delete(ingestBlock).where(and(eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.artifactId, existing.id))),
        auditInsert(ctx, {
          action: "ingest.artifact.reread",
          subjectType: "ingest_artifact",
          subjectId: existing.id,
          meta: { fileName: input.fileName, sha256: input.sha256, from: existing.readState, readError: existing.readError },
        }),
      ],
      { code: "CONFLICT", message: "This file is being read in another tab. Reload and try again." },
    );
    let upload: ArtifactBeginOut["upload"] = null;
    if (existing.vaultState !== "stored" && ready) {
      upload = await ticketFor(existing.id);
      if (existing.vaultState === "not_stored") {
        await ctx.db
          .update(ingestArtifact)
          .set({ vaultState: "pending" })
          .where(and(eq(ingestArtifact.id, existing.id), eq(ingestArtifact.companyId, ctx.companyId)));
      }
    }
    return { artifactId: existing.id, existing: false, uploadedAt: existing.createdAt.getTime(), upload };
  }
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

  if (!keptOnly && (await openStagedRows(ctx)) >= INGEST_LIMITS.openRowsPerPlant) {
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
        readState: keptOnly ? "kept_unread" : "reading",
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

/** A failed read, or a read that found no table (a scan or photo the browser cannot read), may run again. */
function rereadable(a: ArtifactRow): boolean {
  return a.readState === "failed" || (a.readState === "read" && (a.blockCount ?? 0) === 0);
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

type RowDoubtIn = { row: number; code: DoubtCode; line: number; page?: number };

/**
 * Rule 5.3: the reader's doubts of one putRows call by row index. A doubt must name a row of the
 * call, and a row carries each code once, so a call holds at most 5 doubts a row.
 */
function doubtsByRow(fromIndex: number, count: number, doubts: readonly RowDoubtIn[]): Map<number, RowDoubtView[]> {
  const out = new Map<number, RowDoubtView[]>();
  for (const d of doubts) {
    if (d.row < fromIndex || d.row >= fromIndex + count) throw new TRPCError({ code: "BAD_REQUEST", message: "A doubt names a row that was not sent" });
    const list = out.get(d.row) ?? [];
    if (list.some((x) => x.code === d.code)) throw new TRPCError({ code: "BAD_REQUEST", message: "A row has the same doubt twice" });
    list.push(d.page === undefined ? { code: d.code, line: d.line } : { code: d.code, line: d.line, page: d.page });
    out.set(d.row, list);
  }
  return out;
}

export async function putRows(
  ctx: IngestCtx,
  input: { blockId: string; headerRow: number; headerRows: number; fromIndex: number; expectRowsPut: number; rows: string[][]; doubts?: RowDoubtIn[] },
): Promise<{ rowsPut: number }> {
  const doubts = doubtsByRow(input.fromIndex, input.rows.length, input.doubts ?? []);
  const block = await loadBlock(ctx, input.blockId);
  // Rule 7.2: rows are taken only as read under the header the server settled.
  if (input.headerRow !== block.headerRow || input.headerRows !== block.headerRows) {
    throw new TRPCError({ code: "CONFLICT", message: "These rows were read under another header row. Read the table again." });
  }
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
  if (primary.state === "discarded") {
    // The sheet was ignored while its rows were on the way: count them as sent and keep none, so the
    // file can still complete and its other sheets go on (A3).
    await guardedBatch(
      ctx.db,
      [
        ctx.db
          .update(ingestBlock)
          .set({ rowsPut: end })
          .where(and(eq(ingestBlock.id, block.id), eq(ingestBlock.companyId, ctx.companyId), eq(ingestBlock.rowsPut, input.expectRowsPut))),
        ingestAbortUnlessChanged(ctx.db),
      ],
      { code: "CONFLICT", message: "Rows were sent from another tab. Reload and try again." },
    );
    return { rowsPut: end };
  }

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
        doubts: doubts.get(rowIndex) ?? null,
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
  // A kept PDF or photo has nothing to read: complete leaves it as it is.
  if (a.readState === "kept_unread") return { canonicalUploads: [] };
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
    // Rule 4.1: a block whose header is not settled yet is not saved; the file waits for it.
    if (blocks.length < (a.blockCount ?? 0)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Pick the row with the column names for every table first" });
    }
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
    blocks: blocks.map((b) => ({
      ...blockViewFor(
        ctx,
        b,
        candidates.filter((c) => c.blockId === b.id).map((c) => c.recipe),
      ),
      candidates: summaries.filter((s) => s.blockId === b.id),
    })),
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
    ...(await periodRerun(ctx, a.id, null, (a.periodConfirmed?.asOf ?? null) !== input.asOf)),
  ];
  await guardedBatch(ctx.db, statements);
  return artifactSummary(await loadArtifact(ctx, a.id));
}

/**
 * Every orders candidate of the file whose rows take the period's date goes back to processing from
 * row 0, an approved one too (its approval is cleared and audited), so no sheet keeps the old date
 * (A13). A sheet already merging refuses the change. So does a sheet with rows already written or its
 * layout locked by a merge, when the date really changes: its written rows carry the old date, and a
 * new date would leave one file with two order dates. `except` is the candidate the caller changes
 * itself; it is checked too, but not re-queued here.
 */
export async function periodRerun(ctx: IngestCtx, artifactId: string, except: string | null, asOfChanged: boolean): Promise<SqliteBatchItem[]> {
  const affected = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(
      and(
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.artifactId, artifactId),
        eq(ingestCandidate.target, "orders"),
        inArray(ingestCandidate.state, ["processing", "ready", "held", "approved", "merging", "merged"]),
      ),
    );
  const uses = affected.filter((c) => {
    const r = recipeSchema.safeParse(c.recipe);
    return r.success && periodRequired(r.data);
  });
  if (uses.some((c) => c.state === "merging")) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A sheet of this file is being merged. Change the date after the merge." });
  }
  if (asOfChanged && uses.some((c) => c.state === "merged" || c.recipeLocked || c.rowsWritten > 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Rows of this sheet are already merged with the old date" });
  }
  const out: SqliteBatchItem[] = [];
  for (const c of uses) {
    if (c.id === except || c.state === "merged" || c.recipeLocked || c.rowsWritten > 0) continue;
    out.push(...candidateChange(ctx, c.id, c.serverSeq, { state: "processing", dryCursor: 0, approvedBy: null, approvedAt: null }));
    if (c.state === "approved") {
      out.push(
        auditInsert(ctx, { action: "ingest.candidate.recheck", subjectType: "ingest_candidate", subjectId: c.id, meta: { reason: "period_changed", from: c.state } }),
      );
    }
  }
  return out;
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
