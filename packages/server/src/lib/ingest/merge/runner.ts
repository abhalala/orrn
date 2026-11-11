/**
 * The merge run (plan A5, B7): one action merges every approved candidate in dependency order, in
 * bounded steps the browser pumps.
 *
 * - `startMerge` sets every approved candidate to `merging` and opens a run in `planning`. The
 *   partial unique index allows one active run per plant.
 * - Each `stepMerge` call first claims the step: a compare-and-set on the run's `server_seq` guarded
 *   on `cursor = expectCursor`. A second tab with the same cursor gets CONFLICT before anything is
 *   called. The step then plans one page of chunks, or writes one chunk, or finishes the run, and
 *   moves the cursor by one in the batch that records the result (guarded on the cursor again).
 * - Writing a chunk: load its queued rows, resolve `pending:` references against rows written
 *   earlier, mark the chunk `sent`, call the adapter, then one batch records the written rows with
 *   their live ids, the chunk state and the run counters.
 * - A crash between the call and that batch leaves the chunk `sent`; the next step sends it again
 *   with the same ids and the procedure answers `replayed`.
 * - A refused chunk holds its candidate with the exact message (`merge_failed`); a chunk whose rows
 *   point at a record of a held candidate holds its own candidate (`dependency_held`). The rest of
 *   the run goes on. The run ends `done`, or `done_with_holds` when anything was held.
 * - `stopMerge` ends the run after the step in flight: merging candidates go back to approved, their
 *   queued rows to open, planned chunks are dropped. Written rows stay written.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, max, ne, sql } from "drizzle-orm";
import type { SQLiteUpdateSetSource } from "drizzle-orm/sqlite-core";

import {
  ingestArtifact,
  ingestBlock,
  ingestCandidate,
  ingestMergeChunk,
  ingestMergeRun,
  ingestStagedRow,
  type MergeRunState,
} from "@orrn/db/schema/ingest";

import { chunk as chunkList, type SqliteBatchItem } from "../../atomic";
import { auditInsert } from "../../audit";
import { now } from "../../clock";
import { createId } from "../../id";
import { guardedBatch, ingestAbortUnlessChanged, loadCandidate } from "../core";
import { recountStatement } from "../dryrun";
import type { IngestSource } from "../source";
import type { IngestCtx, MergeStepOut } from "../types";
import { ADAPTERS } from "./adapters";
import { callerFor } from "./caller";
import { planPage } from "./planner";
import { failureOf, MESSAGE_MAX, pendingKeys, type ChunkFailure, type StagedRow, type Written } from "./shared";

const ACTIVE: MergeRunState[] = ["planning", "running"];
const OTHER_TAB = { code: "CONFLICT", message: "Running in another tab" } as const;

type RunRow = typeof ingestMergeRun.$inferSelect;

function out(run: RunRow): MergeStepOut {
  return {
    state: run.state,
    cursor: run.cursor,
    chunksTotal: run.chunksTotal,
    chunksWritten: run.chunksWritten,
    chunksFailed: run.chunksFailed,
  };
}

async function loadRun(ctx: Pick<IngestCtx, "db" | "companyId">, runId: string): Promise<RunRow> {
  const [run] = await ctx.db
    .select()
    .from(ingestMergeRun)
    .where(and(eq(ingestMergeRun.id, runId), eq(ingestMergeRun.companyId, ctx.companyId)))
    .limit(1);
  if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Merge not found" });
  return run;
}

/** The run's cursor moves by one, only from `expectCursor` (every step's result batch carries it). */
function advance(ctx: IngestCtx, runId: string, expectCursor: number, set: SQLiteUpdateSetSource<typeof ingestMergeRun> = {}): SqliteBatchItem[] {
  return [
    ctx.db
      .update(ingestMergeRun)
      .set({ ...set, cursor: expectCursor + 1 })
      .where(and(eq(ingestMergeRun.id, runId), eq(ingestMergeRun.companyId, ctx.companyId), eq(ingestMergeRun.cursor, expectCursor))),
    ingestAbortUnlessChanged(ctx.db),
  ];
}

const inIds = (ids: readonly string[]) => chunkList([...ids], 90);

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

export async function startMerge(ctx: IngestCtx): Promise<{ runId: string }> {
  const approved = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "approved")));
  if (approved.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is approved to merge" });
  const runId = createId();
  const ids = approved.map((a) => a.id);
  const statements: SqliteBatchItem[] = [
    ctx.db.insert(ingestMergeRun).values({ id: runId, companyId: ctx.companyId, state: "planning", startedBy: ctx.session.user.id }),
  ];
  for (const part of inIds(ids)) {
    statements.push(
      ctx.db
        .update(ingestCandidate)
        .set({ state: "merging", serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: now() })
        .where(and(eq(ingestCandidate.companyId, ctx.companyId), inArray(ingestCandidate.id, part), eq(ingestCandidate.state, "approved"))),
    );
  }
  statements.push(
    auditInsert(ctx, { action: "ingest.merge.start", subjectType: "ingest_merge_run", subjectId: runId, meta: { candidates: ids.length } }),
  );
  try {
    await guardedBatch(ctx.db, statements);
  } catch (e) {
    if (/UNIQUE constraint failed: ingest_merge_run/.test(errorText(e))) {
      throw new TRPCError({ code: "CONFLICT", message: "A merge is already running" });
    }
    throw e;
  }
  return { runId };
}

function errorText(e: unknown): string {
  let s = "";
  for (let cur: unknown = e, d = 0; cur && d < 6; d += 1) {
    s += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return s;
}

// ---------------------------------------------------------------------------
// step
// ---------------------------------------------------------------------------

export async function stepMerge(ctx: IngestCtx, input: { runId: string; expectCursor: number }): Promise<MergeStepOut> {
  const run = await loadRun(ctx, input.runId);
  if (!ACTIVE.includes(run.state)) return out(run);
  if (run.cursor !== input.expectCursor) throw new TRPCError(OTHER_TAB);
  // Claim the step: a second tab pumping the same cursor stops here, before any call.
  await guardedBatch(
    ctx.db,
    [
      ctx.db
        .update(ingestMergeRun)
        .set({ serverSeq: run.serverSeq + 1 })
        .where(
          and(
            eq(ingestMergeRun.id, run.id),
            eq(ingestMergeRun.companyId, ctx.companyId),
            eq(ingestMergeRun.cursor, input.expectCursor),
            eq(ingestMergeRun.serverSeq, run.serverSeq),
            inArray(ingestMergeRun.state, ACTIVE),
          ),
        ),
      ingestAbortUnlessChanged(ctx.db),
    ],
    OTHER_TAB,
  );
  if (run.state === "planning") await planStep(ctx, run, input.expectCursor);
  else await writeStep(ctx, run, input.expectCursor);
  return out(await loadRun(ctx, run.id));
}

async function planStep(ctx: IngestCtx, run: RunRow, expectCursor: number): Promise<void> {
  const [top] = await ctx.db
    .select({ seq: max(ingestMergeChunk.seq) })
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId)));
  const firstSeq = (top?.seq ?? -1) + 1;
  const page = await planPage(ctx, run.id, firstSeq);
  if (page.done) {
    await guardedBatch(ctx.db, advance(ctx, run.id, expectCursor, { state: "running" }), OTHER_TAB);
    return;
  }
  await guardedBatch(
    ctx.db,
    [...page.statements, ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`${ingestMergeRun.chunksTotal} + ${page.chunks.length}` })],
    OTHER_TAB,
  );
}

/** The rows a `pending:` key names, written earlier: key to live id, plus the names of the held ones. */
async function resolveRefs(
  ctx: IngestCtx,
  keys: readonly string[],
): Promise<{ refs: Map<string, string>; missing: { key: string; name: string } | null }> {
  const refs = new Map<string, string>();
  if (keys.length === 0) return { refs, missing: null };
  const found: { rowKey: string; mergeState: string; committedId: string | null; sheet: string | null; file: string }[] = [];
  for (const part of inIds(keys)) {
    found.push(
      ...(await ctx.db
        .select({
          rowKey: ingestStagedRow.rowKey,
          mergeState: ingestStagedRow.mergeState,
          committedId: ingestStagedRow.committedId,
          sheet: ingestBlock.sheetName,
          file: ingestArtifact.fileName,
        })
        .from(ingestStagedRow)
        .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestStagedRow.candidateId))
        .innerJoin(ingestBlock, eq(ingestBlock.id, ingestCandidate.blockId))
        .innerJoin(ingestArtifact, eq(ingestArtifact.id, ingestCandidate.artifactId))
        .where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.rowKey, part)))),
    );
  }
  for (const f of found) if (f.mergeState === "written" && f.committedId) refs.set(f.rowKey, f.committedId);
  const key = keys.find((k) => !refs.has(k));
  if (!key) return { refs, missing: null };
  const hit = found.find((f) => f.rowKey === key);
  return { refs, missing: { key, name: hit ? (hit.sheet ?? hit.file) : key } };
}

async function writeStep(ctx: IngestCtx, run: RunRow, expectCursor: number): Promise<void> {
  const [chunk] = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId), inArray(ingestMergeChunk.state, ["planned", "sent"])))
    .orderBy(asc(ingestMergeChunk.seq))
    .limit(1);
  if (!chunk) return finish(ctx, run, expectCursor);

  const candidate = await loadCandidate(ctx, chunk.candidateId);
  const rows: StagedRow[] = await ctx.db
    .select()
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.candidateId, chunk.candidateId),
        eq(ingestStagedRow.companyId, ctx.companyId),
        sql`${ingestStagedRow.rowIndex} between ${chunk.rowFrom} and ${chunk.rowTo}`,
        eq(ingestStagedRow.mergeState, "queued"),
        inArray(ingestStagedRow.state, ["ready_create", "ready_update"]),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex));

  // A candidate held since this chunk was planned, or a chunk with nothing left: drop it.
  if (candidate.state !== "merging" || rows.length === 0 || !candidate.target) {
    await guardedBatch(
      ctx.db,
      [
        ...requeue(ctx, rows.map((r) => r.id)),
        ctx.db.delete(ingestMergeChunk).where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId))),
        ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`max(${ingestMergeRun.chunksTotal} - 1, 0)` }),
      ],
      OTHER_TAB,
    );
    return;
  }

  await ctx.db
    .update(ingestMergeChunk)
    .set({ state: "sent", attempts: sql`${ingestMergeChunk.attempts} + 1`, sentAt: now() })
    .where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId)));

  const { refs, missing } = await resolveRefs(ctx, pendingKeys(rows));
  let written: Written[] = [];
  let failure: ChunkFailure | null = null;
  if (missing) {
    failure = { code: "DEPENDENCY_HELD", message: missing.name.slice(0, MESSAGE_MAX), reason: "dependency_held" };
  } else {
    const base: IngestSource = {
      artifactId: candidate.artifactId,
      blockId: candidate.blockId,
      candidateId: candidate.id,
      mergeRunId: run.id,
      chunkId: chunk.id,
      rowFrom: chunk.rowFrom,
      rowTo: chunk.rowTo,
    };
    try {
      const res = await ADAPTERS[candidate.target]({
        ctx,
        callerFor: callerFor(ctx),
        chunk,
        candidate,
        rows,
        refs,
        sourceOf: (part) =>
          part.length === 0 ? base : { ...base, rowFrom: Math.min(...part.map((r) => r.rowIndex)), rowTo: Math.max(...part.map((r) => r.rowIndex)) },
      });
      written = res.written;
      failure = res.failure;
    } catch (e) {
      failure = failureOf(e);
    }
  }
  await recordChunk(ctx, run, expectCursor, chunk, candidate.id, rows, written, failure);
}

function requeue(ctx: IngestCtx, rowIds: readonly string[]): SqliteBatchItem[] {
  return inIds(rowIds).map((part) =>
    ctx.db
      .update(ingestStagedRow)
      .set({ mergeState: "open" })
      .where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part), eq(ingestStagedRow.mergeState, "queued"))),
  );
}

async function recordChunk(
  ctx: IngestCtx,
  run: RunRow,
  expectCursor: number,
  chunk: typeof ingestMergeChunk.$inferSelect,
  candidateId: string,
  rows: readonly StagedRow[],
  written: readonly Written[],
  failure: ChunkFailure | null,
): Promise<void> {
  const at = now();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const statements: SqliteBatchItem[] = [];
  for (const w of written) {
    const row = byId.get(w.rowId);
    statements.push(
      ctx.db
        .update(ingestStagedRow)
        .set({
          mergeState: "written",
          committedType: w.committedType,
          committedId: w.committedId,
          ...(w.reasons ? { reasons: [...(row?.reasons ?? []), ...w.reasons] } : {}),
          updatedAt: at,
        })
        // Not guarded on `queued`: a stop in between may have set the row back to open, and the
        // record was written all the same.
        .where(and(eq(ingestStagedRow.id, w.rowId), eq(ingestStagedRow.companyId, ctx.companyId), ne(ingestStagedRow.mergeState, "written"))),
    );
  }
  if (written.length > 0) {
    statements.push(
      ctx.db
        .update(ingestCandidate)
        .set({ recipeLocked: true })
        .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId))),
    );
  }

  if (!failure) {
    statements.push(
      ctx.db
        .update(ingestMergeChunk)
        .set({ state: "written", writtenAt: at, errorCode: null, errorMessage: null })
        .where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId))),
      recountStatement(ctx, candidateId),
      ...advance(ctx, run.id, expectCursor, { chunksWritten: sql`${ingestMergeRun.chunksWritten} + 1` }),
    );
    await guardedBatch(ctx.db, statements, OTHER_TAB);
    return;
  }

  // The rest of this candidate's planned chunks will not run: drop them and reopen their rows.
  const later = await ctx.db
    .select({ id: ingestMergeChunk.id })
    .from(ingestMergeChunk)
    .where(
      and(
        eq(ingestMergeChunk.runId, run.id),
        eq(ingestMergeChunk.companyId, ctx.companyId),
        eq(ingestMergeChunk.candidateId, candidateId),
        eq(ingestMergeChunk.state, "planned"),
        ne(ingestMergeChunk.id, chunk.id),
      ),
    );
  const writtenIds = new Set(written.map((w) => w.rowId));
  statements.push(
    ctx.db
      .update(ingestMergeChunk)
      .set({ state: "failed", errorCode: failure.code, errorMessage: failure.message.slice(0, MESSAGE_MAX) })
      .where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId))),
    ...requeue(ctx, rows.filter((r) => !writtenIds.has(r.id)).map((r) => r.id)),
  );
  for (const part of inIds(later.map((l) => l.id))) {
    statements.push(ctx.db.delete(ingestMergeChunk).where(and(eq(ingestMergeChunk.companyId, ctx.companyId), inArray(ingestMergeChunk.id, part))));
  }
  statements.push(
    ctx.db
      .update(ingestStagedRow)
      .set({ mergeState: "open" })
      .where(and(eq(ingestStagedRow.candidateId, candidateId), eq(ingestStagedRow.companyId, ctx.companyId), eq(ingestStagedRow.mergeState, "queued"))),
    ctx.db
      .update(ingestCandidate)
      .set({
        state: "held",
        reasonCode: failure.reason,
        reasonDetail: failure.message.slice(0, MESSAGE_MAX),
        approvedBy: null,
        approvedAt: null,
        serverSeq: sql`${ingestCandidate.serverSeq} + 1`,
        updatedAt: at,
      })
      .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging"))),
    recountStatement(ctx, candidateId),
    auditInsert(ctx, {
      action: "ingest.candidate.hold",
      subjectType: "ingest_candidate",
      subjectId: candidateId,
      meta: { reason: failure.reason, detail: failure.message.slice(0, MESSAGE_MAX), code: failure.code, runId: run.id, chunkId: chunk.id },
    }),
    ...advance(ctx, run.id, expectCursor, {
      chunksFailed: sql`${ingestMergeRun.chunksFailed} + 1`,
      chunksTotal: sql`max(${ingestMergeRun.chunksTotal} - ${later.length}, 0)`,
    }),
  );
  await guardedBatch(ctx.db, statements, OTHER_TAB);
}

async function finish(ctx: IngestCtx, run: RunRow, expectCursor: number): Promise<void> {
  const merging = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging")));
  const fresh = await loadRun(ctx, run.id);
  const state: MergeRunState = fresh.chunksFailed > 0 ? "done_with_holds" : "done";
  const at = now();
  const statements: SqliteBatchItem[] = [];
  for (const m of merging) {
    statements.push(
      ctx.db
        .update(ingestCandidate)
        .set({ state: "merged", serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: at })
        .where(and(eq(ingestCandidate.id, m.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging"))),
      recountStatement(ctx, m.id),
    );
  }
  statements.push(
    auditInsert(ctx, {
      action: "ingest.merge.finish",
      subjectType: "ingest_merge_run",
      subjectId: run.id,
      meta: { state, merged: merging.length, chunksWritten: fresh.chunksWritten, chunksFailed: fresh.chunksFailed },
    }),
    ...advance(ctx, run.id, expectCursor, { state, finishedAt: at }),
  );
  await guardedBatch(ctx.db, statements, OTHER_TAB);
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

export async function stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut> {
  const run = await loadRun(ctx, input.runId);
  if (!ACTIVE.includes(run.state)) return out(run);
  const merging = await ctx.db
    .select({ id: ingestCandidate.id })
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging")));
  const at = now();
  const statements: SqliteBatchItem[] = [
    ctx.db
      .update(ingestMergeRun)
      .set({ state: "stopped", finishedAt: at, serverSeq: sql`${ingestMergeRun.serverSeq} + 1` })
      .where(and(eq(ingestMergeRun.id, run.id), eq(ingestMergeRun.companyId, ctx.companyId), inArray(ingestMergeRun.state, ACTIVE))),
    ingestAbortUnlessChanged(ctx.db),
    ctx.db
      .delete(ingestMergeChunk)
      .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "planned"))),
    ctx.db
      .update(ingestMergeRun)
      .set({ chunksTotal: sql`(select count(*) from ingest_merge_chunk c where c.run_id = ${run.id})` })
      .where(and(eq(ingestMergeRun.id, run.id), eq(ingestMergeRun.companyId, ctx.companyId))),
  ];
  for (const m of merging) {
    statements.push(
      ctx.db
        .update(ingestStagedRow)
        .set({ mergeState: "open" })
        .where(and(eq(ingestStagedRow.candidateId, m.id), eq(ingestStagedRow.companyId, ctx.companyId), eq(ingestStagedRow.mergeState, "queued"))),
      ctx.db
        .update(ingestCandidate)
        .set({ state: "approved", serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: at })
        .where(and(eq(ingestCandidate.id, m.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging"))),
      recountStatement(ctx, m.id),
    );
  }
  statements.push(
    auditInsert(ctx, {
      action: "ingest.merge.finish",
      subjectType: "ingest_merge_run",
      subjectId: run.id,
      meta: { state: "stopped", chunksWritten: run.chunksWritten, chunksFailed: run.chunksFailed },
    }),
  );
  await guardedBatch(ctx.db, statements, OTHER_TAB);
  return out(await loadRun(ctx, run.id));
}
