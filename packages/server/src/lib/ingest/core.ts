/**
 * Reads, views and guarded writes shared by the ingest procedures. Every query is scoped by the
 * context's company. A candidate change is a compare-and-set on `server_seq` in the statement's own
 * WHERE; when it lands the batch goes on, when it does not the batch aborts and the caller answers
 * CONFLICT (another tab or person moved the candidate).
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";

import {
  ingestAnswer,
  ingestArtifact,
  ingestBlock,
  ingestCandidate,
  ingestHole,
  ingestHoleVersion,
  type CandidateState,
} from "@orrn/db/schema/ingest";

import { recipeSchema } from "@orrn/ingest";

import { atomicBatch, mapInChunks, type OrrnDb, type SqliteBatchItem } from "../atomic";
import { can } from "../permissions";
import type {
  ArtifactSummary,
  BlockView,
  CandidateCounts,
  CandidateSummary,
  IngestCtx,
} from "./types";

export type ArtifactRow = typeof ingestArtifact.$inferSelect;
export type BlockRow = typeof ingestBlock.$inferSelect;
export type CandidateRow = typeof ingestCandidate.$inferSelect;
export type AnswerRow = typeof ingestAnswer.$inferSelect;

export const NOT_FOUND_ARTIFACT = { code: "NOT_FOUND", message: "Import file not found" } as const;
export const NOT_FOUND_CANDIDATE = { code: "NOT_FOUND", message: "Import not found" } as const;
export const MOVED = { code: "CONFLICT", message: "This import changed in another tab. Reload and try again." } as const;

// ---------------------------------------------------------------------------
// Batch abort
// ---------------------------------------------------------------------------

/**
 * A statement that fails the whole batch unless `landed` holds: it inserts an all-NULL row into
 * `ingest_answer` (NOT NULL on id) and inserts nothing when `landed` is true. Catch with
 * `isIngestAbort`.
 */
export function ingestAbortUnless(db: OrrnDb, landed: SQL): SqliteBatchItem {
  return db.run(
    sql`insert into ingest_answer (id, company_id, candidate_id, question_code, subject, answer) select null, null, null, null, null, null where not (${landed})`,
  ) as unknown as SqliteBatchItem;
}

/** Fails the batch unless the statement right before it changed at least one row. */
export function ingestAbortUnlessChanged(db: OrrnDb): SqliteBatchItem {
  return ingestAbortUnless(db, sql`changes() > 0`);
}

export function isIngestAbort(e: unknown): boolean {
  const needle = "NOT NULL constraint failed: ingest_answer.id";
  for (let cur: unknown = e, depth = 0; cur && depth < 6; depth += 1) {
    if ((cur instanceof Error ? cur.message : String(cur)).includes(needle)) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** Run a batch; an ingest abort becomes `refusal` (CONFLICT by default). */
export async function guardedBatch(
  db: OrrnDb,
  statements: readonly SqliteBatchItem[],
  refusal: { code: "CONFLICT" | "BAD_REQUEST" | "PRECONDITION_FAILED"; message: string } = MOVED,
): Promise<void> {
  try {
    await atomicBatch(db, statements);
  } catch (e) {
    if (isIngestAbort(e)) throw new TRPCError(refusal);
    // Two people saved a version of one layout at once: the second is told to reload (A37).
    if (/UNIQUE constraint failed: ingest_hole_version/.test(String((e as Error)?.message ?? e)) || /UNIQUE constraint failed: ingest_hole_version/.test(String((e as { cause?: unknown })?.cause ?? ""))) {
      throw new TRPCError(MOVED);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Loads
// ---------------------------------------------------------------------------

export async function loadArtifact(ctx: Pick<IngestCtx, "db" | "companyId">, artifactId: string): Promise<ArtifactRow> {
  const [row] = await ctx.db
    .select()
    .from(ingestArtifact)
    .where(and(eq(ingestArtifact.id, artifactId), eq(ingestArtifact.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(NOT_FOUND_ARTIFACT);
  return row;
}

export async function loadBlock(ctx: Pick<IngestCtx, "db" | "companyId">, blockId: string): Promise<BlockRow> {
  const [row] = await ctx.db
    .select()
    .from(ingestBlock)
    .where(and(eq(ingestBlock.id, blockId), eq(ingestBlock.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Sheet not found" });
  return row;
}

export async function loadCandidate(ctx: Pick<IngestCtx, "db" | "companyId">, candidateId: string): Promise<CandidateRow> {
  const [row] = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId)))
    .limit(1);
  if (!row) throw new TRPCError(NOT_FOUND_CANDIDATE);
  return row;
}

/** The candidate, refused with CONFLICT when its seq moved past `expectSeq`. */
export async function loadCandidateAt(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  candidateId: string,
  expectSeq: number,
): Promise<CandidateRow> {
  const row = await loadCandidate(ctx, candidateId);
  if (row.serverSeq !== expectSeq) throw new TRPCError(MOVED);
  return row;
}

/** An update of one candidate guarded on its seq, which it advances. Follow it with `ingestAbortUnlessChanged`. */
export function candidateCas(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  candidateId: string,
  expectSeq: number,
  set: Partial<typeof ingestCandidate.$inferInsert>,
): SqliteBatchItem {
  return ctx.db
    .update(ingestCandidate)
    .set({ ...set, serverSeq: expectSeq + 1, updatedAt: new Date() })
    .where(
      and(
        eq(ingestCandidate.id, candidateId),
        eq(ingestCandidate.companyId, ctx.companyId),
        eq(ingestCandidate.serverSeq, expectSeq),
      ),
    );
}

/** The two statements of a guarded candidate change. */
export function candidateChange(
  ctx: Pick<IngestCtx, "db" | "companyId">,
  candidateId: string,
  expectSeq: number,
  set: Partial<typeof ingestCandidate.$inferInsert>,
): SqliteBatchItem[] {
  return [candidateCas(ctx, candidateId, expectSeq, set), ingestAbortUnlessChanged(ctx.db)];
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const ms = (d: Date | null | undefined) => (d ? d.getTime() : 0);

export function artifactSummary(a: ArtifactRow): ArtifactSummary {
  return {
    id: a.id,
    sha256: a.sha256,
    fileName: a.fileName,
    contentType: a.contentType,
    kind: a.kind,
    sizeBytes: a.sizeBytes,
    vaultState: a.vaultState,
    readState: a.readState,
    readError: a.readError,
    blockCount: a.blockCount,
    rowCount: a.rowCount,
    period: a.period ?? null,
    periodConfirmed: a.periodConfirmed ?? null,
    note: a.note,
    uploadedBy: a.uploadedBy,
    createdAt: ms(a.createdAt),
  };
}

export function blockView(b: BlockRow): BlockView {
  return {
    id: b.id,
    ordinal: b.ordinal,
    sheetName: b.sheetName,
    title: b.title,
    headerRow: b.headerRow,
    headerRows: b.headerRows,
    headers: b.headers,
    kinds: b.kinds,
    headerKey: b.headerKey,
    columnCount: b.columnCount,
    rowCount: b.rowCount,
    rowsPut: b.rowsPut,
    sample: b.sample,
    readBy: b.readBy,
    modelChecked: b.modelChecked,
    canonicalStored: b.canonicalStored,
  };
}

// ---------------------------------------------------------------------------
// Rates (plan A8, D8)
// ---------------------------------------------------------------------------

export const RATE_FIELDS = ["rate"];

export function rateColumns(recipe: unknown): number[] {
  const parsed = recipeSchema.safeParse(recipe);
  if (!parsed.success) return [];
  return parsed.data.fields
    .filter((f) => RATE_FIELDS.includes(f.field) && f.source.kind === "columns")
    .flatMap((f) => (f.source.kind === "columns" ? f.source.cols.map((x) => x.col) : []));
}

/** A header that reads as a rate or price (Rate, Price, Rs/kg, Rs per kg, a rupee sign). */
const RATE_HEADER = /\b(rate|rates|price|prices)\b|\brs\.?\s*(\/|per)\s*(kg|kgs|t|ton|tonne|qtl)\b|\u20b9/i;

export function seesRates(ctx: Pick<IngestCtx, "role">): boolean {
  return can({ company: { role: ctx.role }, isPlatformAdmin: false, platformRole: null }, "order.price");
}

/**
 * The columns a viewer without order.price must not read (plan A8, D8): every column a recipe on the
 * block maps to a rate field, and every column whose header reads as a rate, so a block with no
 * layout yet is covered too (A6, A7, A14, A18, A22).
 */
export function rateMaskColumns(headers: readonly string[], recipes: readonly unknown[]): Set<number> {
  const cols = new Set<number>();
  for (const r of recipes) for (const col of rateColumns(r)) cols.add(col);
  headers.forEach((h, i) => {
    if (RATE_HEADER.test(h)) cols.add(i);
  });
  return cols;
}

export function maskCells(raw: readonly string[], cols: ReadonlySet<number>): string[] {
  return raw.map((cell, i) => (cols.has(i) ? "" : cell));
}

/** A block as one viewer may see it: the sample's rate cells blank without order.price. */
export function blockViewFor(ctx: Pick<IngestCtx, "role">, block: BlockRow, recipes: readonly unknown[]): BlockView {
  const view = blockView(block);
  if (seesRates(ctx)) return view;
  const cols = rateMaskColumns(block.headers, recipes);
  return cols.size === 0 ? view : { ...view, sample: view.sample.map((r) => maskCells(r, cols)) };
}

export function candidateCounts(c: CandidateRow): CandidateCounts {
  return {
    total: c.rowsTotal,
    create: c.rowsCreate,
    update: c.rowsUpdate,
    unchanged: c.rowsUnchanged,
    ambiguous: c.rowsAmbiguous,
    conflict: c.rowsConflict,
    refused: c.rowsRefused,
    skipped: c.rowsSkipped,
    written: c.rowsWritten,
    filled: c.rowsFilled,
    skippedByPerson: c.rowsSkippedByPerson,
  };
}

type SummaryExtras = { fileName: string; sheetName: string | null; blockOrdinal: number; holeName: string | null };

export function candidateSummary(c: CandidateRow, x: SummaryExtras): CandidateSummary {
  return {
    id: c.id,
    artifactId: c.artifactId,
    blockId: c.blockId,
    parentId: c.parentId,
    target: c.target,
    holeRef: c.holeRef,
    holeName: x.holeName,
    fit: c.fit,
    fitScore: c.fitScore,
    state: c.state,
    reasonCode: c.reasonCode,
    reasonDetail: c.reasonDetail,
    serverSeq: c.serverSeq,
    dryCursor: c.dryCursor,
    counts: candidateCounts(c),
    openQuestions: c.openQuestions,
    botAttempts: c.botAttempts,
    recipeLocked: c.recipeLocked,
    fileName: x.fileName,
    sheetName: x.sheetName,
    blockOrdinal: x.blockOrdinal,
    updatedAt: ms(c.updatedAt),
  };
}

/** Summaries for candidate rows, with their file, sheet and learned layout names (chunked reads). */
export async function summarize(ctx: Pick<IngestCtx, "db" | "companyId">, rows: readonly CandidateRow[]): Promise<CandidateSummary[]> {
  if (rows.length === 0) return [];
  const artifactIds = [...new Set(rows.map((r) => r.artifactId))];
  const blockIds = [...new Set(rows.map((r) => r.blockId))];
  const versionIds = [
    ...new Set(rows.map((r) => r.holeRef).filter((h): h is string => !!h && h.startsWith("learned:")).map((h) => h.slice(8))),
  ];
  const arts = await mapInChunks(artifactIds, (ids) =>
    ctx.db
      .select({ id: ingestArtifact.id, fileName: ingestArtifact.fileName })
      .from(ingestArtifact)
      .where(and(eq(ingestArtifact.companyId, ctx.companyId), inArray(ingestArtifact.id, ids))),
  );
  const blocks = await mapInChunks(blockIds, (ids) =>
    ctx.db
      .select({ id: ingestBlock.id, sheetName: ingestBlock.sheetName, ordinal: ingestBlock.ordinal })
      .from(ingestBlock)
      .where(and(eq(ingestBlock.companyId, ctx.companyId), inArray(ingestBlock.id, ids))),
  );
  const holes = await mapInChunks(versionIds, (ids) =>
    ctx.db
      .select({ id: ingestHoleVersion.id, name: ingestHole.name })
      .from(ingestHoleVersion)
      .innerJoin(ingestHole, eq(ingestHole.id, ingestHoleVersion.holeId))
      .where(and(eq(ingestHoleVersion.companyId, ctx.companyId), inArray(ingestHoleVersion.id, ids))),
  );
  const artBy = new Map(arts.map((a) => [a.id, a]));
  const blockBy = new Map(blocks.map((b) => [b.id, b]));
  const holeBy = new Map(holes.map((h) => [h.id, h.name]));
  return rows.map((c) =>
    candidateSummary(c, {
      fileName: artBy.get(c.artifactId)?.fileName ?? "",
      sheetName: blockBy.get(c.blockId)?.sheetName ?? null,
      blockOrdinal: blockBy.get(c.blockId)?.ordinal ?? 0,
      holeName: c.holeRef?.startsWith("learned:") ? (holeBy.get(c.holeRef.slice(8)) ?? null) : null,
    }),
  );
}

/** Candidate states that may still change by a person (not merging, merged or discarded). */
export const EDITABLE_STATES: readonly CandidateState[] = ["processing", "needs_shape", "needs_confirm", "ready", "held", "failed"];

export function assertState(c: CandidateRow, allowed: readonly CandidateState[], message: string): void {
  if (!allowed.includes(c.state)) throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** Opaque cursor: `<createdAtMs>:<id>`, newest first. */
export function encodeCursor(createdAt: Date, id: string): string {
  return `${createdAt.getTime()}:${id}`;
}

export function decodeCursor(cursor: string | undefined): { at: number; id: string } | null {
  if (!cursor) return null;
  const m = /^(\d{1,15}):(.{1,64})$/.exec(cursor);
  if (!m) throw new TRPCError({ code: "BAD_REQUEST", message: "Bad page cursor" });
  return { at: Number(m[1]), id: m[2]! };
}
