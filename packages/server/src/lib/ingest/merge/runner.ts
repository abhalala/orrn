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
 * - `stopMerge` ends the run between steps: merging candidates go back to approved, their queued
 *   rows to open, planned chunks are dropped. Written rows stay written. It is refused while a
 *   chunk is sent (in flight, or left by a crash): the next step finishes that chunk first (B4).
 * - A sent chunk whose lease ran out after CHUNK_MAX_SENDS sends is stuck (B-new-1). The next step,
 *   or a stop, marks it failed and holds its candidate, and its rows stay queued. When that
 *   candidate merges again, the run resends the chunk with the same rows and keys before anything
 *   else is planned.
 */
import { ORDER_SKIPPED_LINES } from "../dryrun";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
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
import type { IngestSource } from "../source";
import type { IngestCtx, MergeStepOut } from "../types";
import { ADAPTERS } from "./adapters";
import { callerFor } from "./caller";
import { chunkIdOf, MARKER_DONE, planPage } from "./planner";
import {
  CHUNK_MARK,
  companyNotIndexed,
  failureOf,
  finishedSeq,
  MESSAGE_MAX,
  pendingKeys,
  SEQ_PLANNED_FROM,
  type ChunkFailure,
  type ChunkRow,
  type StagedRow,
  type Written,
} from "./shared";

const ACTIVE: MergeRunState[] = ["planning", "running"];
/**
 * How long a sent chunk belongs to the step that sent it. Another step may send it again only
 * after this, which is how a step that crashed is recovered (B9).
 */
export const CHUNK_LEASE_MS = 60_000;
/**
 * A sent chunk whose lease ran out after this many sends is stuck: every try ended the request
 * before its result was recorded (B-new-1). It is not sent again in this run.
 */
export const CHUNK_MAX_SENDS = 3;
/**
 * The error code of a stuck chunk. Its rows stay `queued`, so they cannot be edited, and its
 * candidate is held. When the candidate merges again, the first planning step moves the chunk into
 * the new run and the next step resends it with the same rows and keys, before anything else.
 */
export const STUCK_CODE = "CHUNK_STUCK";
export const STUCK_MESSAGE =
  "One part of this import stopped the server on each of 3 tries. Its rows are kept as they were. Approve the import again to try that part once more, or tell support.";
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

/**
 * The run's cursor moves by one, only from `expectCursor` (every step's result batch carries it).
 * `active` also requires the run to be planning or running: planning and finishing write nothing
 * live, so a stop in between wins. Recording a written chunk does not require it: the records were
 * written and must be recorded even when a stop landed meanwhile.
 */
function advance(
  ctx: IngestCtx,
  runId: string,
  expectCursor: number,
  set: SQLiteUpdateSetSource<typeof ingestMergeRun> = {},
  opts: { active?: boolean } = {},
): SqliteBatchItem[] {
  return [
    ctx.db
      .update(ingestMergeRun)
      .set({ ...set, cursor: expectCursor + 1 })
      .where(
        and(
          eq(ingestMergeRun.id, runId),
          eq(ingestMergeRun.companyId, ctx.companyId),
          eq(ingestMergeRun.cursor, expectCursor),
          opts.active ? inArray(ingestMergeRun.state, ACTIVE) : undefined,
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
  ];
}

const inIds = (ids: readonly string[]) => chunkList([...ids], 90);

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------

/** Rule 10.2: the words when every approved sheet's file is being read again. */
export const MERGE_FILE_READING = "A file is being read again. Finish it, then merge.";

export async function startMerge(ctx: IngestCtx): Promise<{ runId: string }> {
  const all = await ctx.db
    .select({ id: ingestCandidate.id, readState: ingestArtifact.readState })
    .from(ingestCandidate)
    .innerJoin(ingestArtifact, and(eq(ingestArtifact.id, ingestCandidate.artifactId), eq(ingestArtifact.companyId, ctx.companyId)))
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "approved")));
  if (all.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "Nothing is approved to merge" });
  // Rule 10.2: a sheet whose file is being read again stays approved and is not merged.
  const approved = all.filter((a) => a.readState === "read");
  if (approved.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: MERGE_FILE_READING });
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
        .where(
          and(
            eq(ingestCandidate.companyId, ctx.companyId),
            inArray(ingestCandidate.id, part),
            eq(ingestCandidate.state, "approved"),
            // Rule 10.2, inside the batch: the file is still read.
            sql`exists (select 1 from ingest_artifact a where a.id = ${ingestCandidate.artifactId} and a.read_state = 'read')`,
          ),
        ),
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
  // A stuck chunk moved in from an earlier run is resent first, while nothing else of its candidate
  // is queued, so its range holds exactly its own rows (B-new-1). It was moved to the top of the
  // planned chunks, so only the top one is read.
  const [top] = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), gte(ingestMergeChunk.seq, SEQ_PLANNED_FROM), eq(ingestMergeChunk.companyId, ctx.companyId)))
    .orderBy(desc(ingestMergeChunk.seq))
    .limit(1);
  if (top && top.errorCode === STUCK_CODE && (top.state === "planned" || top.state === "sent")) {
    return writeChunk(ctx, run, expectCursor, top);
  }
  const firstSeq = top ? top.seq + 1 : SEQ_PLANNED_FROM;

  // A stuck chunk of a candidate merging again moves into this run before anything is planned. It
  // keeps its id (its replay key) and its STUCK_CODE, which marks it for the resend above. Looked
  // for only until planning starts (no planned chunk, no empty chunk yet): it walks the chunks of
  // the merging candidates.
  const [stuck] = top || (await planningStarted(ctx, run.id)) ? [] : await ctx.db
    .select({ id: ingestMergeChunk.id })
    .from(ingestMergeChunk)
    .innerJoin(ingestCandidate, eq(ingestCandidate.id, ingestMergeChunk.candidateId))
    .where(
      and(
        eq(ingestMergeChunk.companyId, ctx.companyId),
        eq(ingestMergeChunk.state, "failed"),
        eq(ingestMergeChunk.errorCode, STUCK_CODE),
        ne(ingestMergeChunk.runId, run.id),
        eq(ingestCandidate.state, "merging"),
      ),
    )
    .limit(1);
  if (stuck) {
    await guardedBatch(
      ctx.db,
      [
        ctx.db
          .update(ingestMergeChunk)
          .set({ runId: run.id, seq: firstSeq, state: "planned", attempts: 0, sentAt: null, writtenAt: null })
          .where(and(eq(ingestMergeChunk.id, stuck.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "failed"))),
        ingestAbortUnlessChanged(ctx.db),
        ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`${ingestMergeRun.chunksTotal} + 1` }, { active: true }),
      ],
      OTHER_TAB,
    );
    return;
  }

  const page = await planPage(ctx, run.id, firstSeq, top);
  if (page.done) {
    await guardedBatch(ctx.db, advance(ctx, run.id, expectCursor, { state: "running" }, { active: true }), OTHER_TAB);
    return;
  }
  if (page.hold || page.empty) {
    const candidate = await loadCandidate(ctx, page.candidateId);
    const at = now();
    const marker = {
      id: page.hold ? page.hold.chunkId : page.empty!,
      companyId: ctx.companyId,
      runId: run.id,
      candidateId: page.candidateId,
      target: candidate.target!,
      // Finished when recorded: below the planned chunks (SEQ_PLANNED_FROM).
      seq: finishedSeq(run.id),
      // A hold has no rows. An empty chunk records how far planning read (MARKER_DONE, MARKER_MORE).
      rowFrom: page.marker?.rowFrom ?? MARKER_DONE,
      rowTo: page.marker?.rowTo ?? -1,
      rowCount: 0,
      state: page.hold ? ("failed" as const) : ("written" as const),
      attempts: 0,
      errorCode: page.hold ? page.hold.failure.code : null,
      errorMessage: page.hold ? page.hold.failure.message : null,
      sentAt: null,
      writtenAt: page.hold ? null : at,
    };
    const { id: _id, companyId: _c, ...again } = marker;
    const insert = ctx.db.insert(ingestMergeChunk).values(marker).onConflictDoUpdate({ target: ingestMergeChunk.id, set: again });
    if (page.hold) {
      // Held before anything of it was written (B1, B5). Chunks planned for it on earlier pages are
      // left planned: the write step drops each one, one chunk a step, and opens its rows (M-new-4).
      await guardedBatch(
        ctx.db,
        [
          insert,
          ...holdStatements(ctx, run, page.candidateId, marker.id, page.hold.failure, at),
          ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`${ingestMergeRun.chunksTotal} + 1`, chunksFailed: sql`${ingestMergeRun.chunksFailed} + 1` }, { active: true }),
        ],
        OTHER_TAB,
      );
    } else {
      await guardedBatch(
        ctx.db,
        // The empty chunk only lists the candidate in the run; it is not counted as a part.
        [insert, ...advance(ctx, run.id, expectCursor, {}, { active: true })],
        OTHER_TAB,
      );
    }
    return;
  }
  await guardedBatch(
    ctx.db,
    [...page.statements, ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`${ingestMergeRun.chunksTotal} + ${page.chunks.length}` }, { active: true })],
    OTHER_TAB,
  );
}

/** True once planning recorded anything but a resent chunk: the top finished chunk is an empty one. */
async function planningStarted(ctx: IngestCtx, runId: string): Promise<boolean> {
  const [low] = await ctx.db
    .select({ rowCount: ingestMergeChunk.rowCount })
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, runId), lt(ingestMergeChunk.seq, SEQ_PLANNED_FROM), eq(ingestMergeChunk.companyId, ctx.companyId)))
    .orderBy(desc(ingestMergeChunk.seq))
    .limit(1);
  return low?.rowCount === 0;
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
    // Only planned and sent chunks sit at SEQ_PLANNED_FROM and above: one read, however many
    // chunks the run has finished (B-new-2).
    .where(
      and(
        eq(ingestMergeChunk.runId, run.id),
        gte(ingestMergeChunk.seq, SEQ_PLANNED_FROM),
        eq(ingestMergeChunk.companyId, ctx.companyId),
        inArray(ingestMergeChunk.state, ["planned", "sent"]),
      ),
    )
    .orderBy(asc(ingestMergeChunk.seq))
    .limit(1);
  if (!chunk) return finish(ctx, run, expectCursor);
  return writeChunk(ctx, run, expectCursor, chunk);
}

/**
 * The queued rows of a chunk, read by its mark (B-new-2): one indexed lookup on
 * `ingest_staged_row_committed_idx` that reads only the chunk's own rows, however its range overlaps
 * other chunks. Never more than `rowCount` + 1 rows; the caller checks the chunk id against them.
 */
async function chunkRows(ctx: IngestCtx, chunk: ChunkRow): Promise<StagedRow[]> {
  return ctx.db
    .select()
    .from(ingestStagedRow)
    .where(
      and(
        eq(ingestStagedRow.companyId, ctx.companyId),
        eq(ingestStagedRow.committedType, CHUNK_MARK),
        eq(ingestStagedRow.committedId, chunk.id),
        // Not the index: the mark's index reads only the chunk's rows (a unary plus, as companyNotIndexed).
        sql`+${ingestStagedRow.candidateId} = ${chunk.candidateId}`,
        eq(ingestStagedRow.mergeState, "queued"),
        inArray(ingestStagedRow.state, ["ready_create", "ready_update"]),
      ),
    )
    .orderBy(asc(ingestStagedRow.rowIndex))
    .limit(chunk.rowCount + 1);
}

/**
 * The queued rows of these chunks open again and lose their mark. Read by the mark's index, so it
 * touches only those rows, never the whole candidate.
 */
function reopenChunks(ctx: IngestCtx, chunkIds: readonly string[]): SqliteBatchItem[] {
  return inIds(chunkIds).map((part) =>
    ctx.db
      .update(ingestStagedRow)
      .set({ mergeState: "open", committedType: null, committedId: null })
      .where(
        and(
          eq(ingestStagedRow.companyId, ctx.companyId),
          eq(ingestStagedRow.committedType, CHUNK_MARK),
          inArray(ingestStagedRow.committedId, part),
          eq(ingestStagedRow.mergeState, "queued"),
        ),
      ),
  );
}

/**
 * The candidate's written count grows by the rows of `rowIds` not yet written. Read by primary key
 * before those rows are marked written in the same batch, so a resend never counts a row twice.
 * This replaces a recount of the whole candidate on every step (B-new-2).
 */
function writtenCount(ctx: IngestCtx, candidateId: string, rowIds: readonly string[]): SqliteBatchItem[] {
  return chunkList([...new Set(rowIds)], 90).map((part) =>
    ctx.db
      .update(ingestCandidate)
      .set({
        rowsWritten: sql`${ingestCandidate.rowsWritten} + (${ctx.db
          .select({ n: sql<number>`count(*)` })
          .from(ingestStagedRow)
          .where(and(companyNotIndexed(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part), ne(ingestStagedRow.mergeState, "written")))})`,
      })
      .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId))),
  );
}

/** A sent chunk whose lease ran out after CHUNK_MAX_SENDS sends (B-new-1). */
function isStuck(chunk: ChunkRow, at: Date): boolean {
  return chunk.state === "sent" && chunk.attempts >= CHUNK_MAX_SENDS && (!chunk.sentAt || chunk.sentAt.getTime() < at.getTime() - CHUNK_LEASE_MS);
}

/**
 * Mark a stuck chunk failed and hold its candidate, without reopening the chunk's rows: some of
 * them may have landed, so they stay `queued` with their mark (not editable) until a later run
 * resends the chunk with the same keys. The rows of `others` (the candidate's other planned chunks)
 * open again.
 */
function stuckStatements(ctx: IngestCtx, run: RunRow, chunk: ChunkRow, at: Date): SqliteBatchItem[] {
  const failure: ChunkFailure = { code: STUCK_CODE, message: STUCK_MESSAGE, reason: "merge_failed" };
  return [
    ctx.db
      .update(ingestMergeChunk)
      .set({ state: "failed", errorCode: STUCK_CODE, errorMessage: STUCK_MESSAGE, seq: finishedSeq(run.id) })
      .where(
        and(
          eq(ingestMergeChunk.id, chunk.id),
          eq(ingestMergeChunk.companyId, ctx.companyId),
          // A moved stuck chunk not yet resent (a stop in planning) is still planned.
          chunk.state === "planned"
            ? eq(ingestMergeChunk.state, "planned")
            : and(eq(ingestMergeChunk.state, "sent"), chunk.sentAt ? eq(ingestMergeChunk.sentAt, chunk.sentAt) : isNull(ingestMergeChunk.sentAt)),
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
    ...holdStatements(ctx, run, chunk.candidateId, chunk.id, failure, at),
  ];
}

async function writeChunk(ctx: IngestCtx, run: RunRow, expectCursor: number, chunk: ChunkRow): Promise<void> {
  const candidate = await loadCandidate(ctx, chunk.candidateId);
  // A candidate held since this chunk was planned: drop the chunk and open its rows by the chunk
  // mark, without reading them first (M-new-4: one chunk a step).
  const held = candidate.state !== "merging" || !candidate.target;
  const rows = held ? [] : await chunkRows(ctx, chunk);

  // A held candidate, or a chunk with nothing left: drop it.
  if (held || rows.length === 0 || !candidate.target) {
    await guardedBatch(
      ctx.db,
      [
        ...(held ? reopenChunks(ctx, [chunk.id]) : []),
        ctx.db.delete(ingestMergeChunk).where(and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId))),
        ...advance(ctx, run.id, expectCursor, { chunksTotal: sql`max(${ingestMergeRun.chunksTotal} - 1, 0)` }),
      ],
      OTHER_TAB,
    );
    return;
  }

  // Every send so far ended the request before its result was recorded: not sent again (B-new-1).
  if (isStuck(chunk, now())) {
    // The candidate's other planned chunks are dropped by later steps, one a step (M-new-4).
    await guardedBatch(
      ctx.db,
      [
        ...stuckStatements(ctx, run, chunk, now()),
        ...advance(ctx, run.id, expectCursor, { chunksFailed: sql`${ingestMergeRun.chunksFailed} + 1` }),
      ],
      OTHER_TAB,
    );
    return;
  }

  // Claim the chunk (B9): a compare-and-set from planned, or from sent once the lease of the step
  // that sent it has run out. A second step on the same chunk stops here, before any call. The
  // claim time is the lease token: the result batch only lands while it still holds.
  const claimedAt = now();
  await guardedBatch(
    ctx.db,
    [
      ctx.db
        .update(ingestMergeChunk)
        .set({ state: "sent", attempts: sql`${ingestMergeChunk.attempts} + 1`, sentAt: claimedAt })
        .where(
          and(
            eq(ingestMergeChunk.id, chunk.id),
            eq(ingestMergeChunk.companyId, ctx.companyId),
            eq(ingestMergeChunk.runId, run.id),
            or(
              eq(ingestMergeChunk.state, "planned"),
              and(
                eq(ingestMergeChunk.state, "sent"),
                or(isNull(ingestMergeChunk.sentAt), lt(ingestMergeChunk.sentAt, new Date(claimedAt.getTime() - CHUNK_LEASE_MS))),
              ),
            ),
          ),
        ),
      ingestAbortUnlessChanged(ctx.db),
    ],
    OTHER_TAB,
  );

  const { refs, missing } = await resolveRefs(ctx, pendingKeys(rows));
  let written: Written[] = [];
  let failure: ChunkFailure | null = null;
  // The rows must be the ones the chunk was planned with (its id hashes them).
  const planned =
    (await chunkIdOf({ candidateId: candidate.id, target: candidate.target, holeRef: candidate.holeRef, rowFrom: chunk.rowFrom, rowTo: chunk.rowTo, rowIds: rows.map((r) => r.id) })) === chunk.id;
  if (!planned) {
    failure = { code: "CONFLICT", message: "The rows of this part changed after the merge was planned. Run the merge again.", reason: "merge_failed" };
  } else if (missing) {
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
        sourceOf: (part) => {
          if (part.length === 0) return base;
          const confirmed = part.filter((r) => r.doubtBy && r.doubts?.length).map((r) => ({ row: r.rowIndex, by: r.doubtBy!, codes: r.doubts!.map((d) => d.code) }));
          // Rule 7.1: an order imported without lines a person skipped says so.
          const skippedLines = Math.max(0, ...part.flatMap((r) => (r.reasons ?? []).filter((x) => x.startsWith(ORDER_SKIPPED_LINES)).map((x) => Number(x.slice(ORDER_SKIPPED_LINES.length)) || 0)));
          const skipped = skippedLines > 0 ? { skippedLines, note: `Imported without ${skippedLines} ${skippedLines === 1 ? "line" : "lines"} the person skipped` } : {};
          return { ...base, rowFrom: Math.min(...part.map((r) => r.rowIndex)), rowTo: Math.max(...part.map((r) => r.rowIndex)), ...(confirmed.length ? { confirmed } : {}), ...skipped };
        },
      });
      written = res.written;
      failure = res.failure;
    } catch (e) {
      failure = failureOf(e);
    }
  }
  await recordChunk(ctx, run, expectCursor, { ...chunk, sentAt: claimedAt }, candidate.id, rows, written, failure);
}

function requeue(ctx: IngestCtx, rowIds: readonly string[]): SqliteBatchItem[] {
  return inIds(rowIds).map((part) =>
    ctx.db
      .update(ingestStagedRow)
      .set({ mergeState: "open", committedType: null, committedId: null })
      .where(and(companyNotIndexed(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part), eq(ingestStagedRow.mergeState, "queued"))),
  );
}

/** Rows recorded by one statement when each row has its own record id: 3 bound values a row. */
const RECORD_PER_STATEMENT = 30;

/**
 * Mark written rows with their live records in few statements (Bm7): rows that share a record and
 * reasons (the lines of one order) in one statement per 90; rows with their own record id 30 to a
 * statement through a CASE on the row id. Reasons are appended to the row's own list. Not guarded
 * on `queued`: a stop in between may have set a row back to open, and the record was written all
 * the same.
 */
function recordWritten(ctx: IngestCtx, written: readonly Written[], at: Date): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  const target = (ids: readonly string[]) =>
    and(companyNotIndexed(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, [...ids]), ne(ingestStagedRow.mergeState, "written"));
  const appended = (reasons: readonly string[]) =>
    reasons.reduce<SQL>((acc, r) => sql`json_insert(${acc}, '$[#]', ${r})`, sql`coalesce(${ingestStagedRow.reasons}, '[]')`);
  const shared = new Map<string, Written[]>();
  for (const w of written) {
    const key = JSON.stringify([w.committedType, w.committedId, w.reasons ?? []]);
    shared.set(key, [...(shared.get(key) ?? []), w]);
  }
  const single = new Map<string, Written[]>();
  for (const list of shared.values()) {
    const w = list[0]!;
    if (list.length === 1 && !w.reasons?.length) {
      single.set(w.committedType, [...(single.get(w.committedType) ?? []), w]);
      continue;
    }
    for (const part of inIds(list.map((x) => x.rowId))) {
      out.push(
        ctx.db
          .update(ingestStagedRow)
          .set({
            mergeState: "written",
            committedType: w.committedType,
            committedId: w.committedId,
            ...(w.reasons?.length ? { reasons: appended(w.reasons) } : {}),
            updatedAt: at,
          })
          .where(target(part)),
      );
    }
  }
  for (const [type, list] of single) {
    for (const part of chunkList(list, RECORD_PER_STATEMENT)) {
      out.push(
        ctx.db
          .update(ingestStagedRow)
          .set({
            mergeState: "written",
            committedType: type,
            committedId: sql`case ${ingestStagedRow.id} ${sql.join(
              part.map((w) => sql`when ${w.rowId} then ${w.committedId}`),
              sql` `,
            )} end`,
            updatedAt: at,
          })
          .where(target(part.map((w) => w.rowId))),
      );
    }
  }
  return out;
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
  // Counted before the rows are marked written (B-new-2: no recount of the whole candidate).
  const statements: SqliteBatchItem[] = [...writtenCount(ctx, candidateId, written.map((w) => w.rowId)), ...recordWritten(ctx, written, at)];
  if (written.length > 0) {
    statements.push(
      ctx.db
        .update(ingestCandidate)
        .set({ recipeLocked: true })
        .where(and(eq(ingestCandidate.id, candidateId), eq(ingestCandidate.companyId, ctx.companyId))),
    );
  }

  // Lands only while this step still holds the chunk's lease (B9).
  const mine = and(eq(ingestMergeChunk.id, chunk.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "sent"), eq(ingestMergeChunk.sentAt, chunk.sentAt!));
  if (!failure) {
    statements.push(
      ctx.db.update(ingestMergeChunk).set({ state: "written", writtenAt: at, errorCode: null, errorMessage: null, seq: finishedSeq(run.id) }).where(mine),
      ingestAbortUnlessChanged(ctx.db),
      ...advance(ctx, run.id, expectCursor, { chunksWritten: sql`${ingestMergeRun.chunksWritten} + 1` }),
    );
    await guardedBatch(ctx.db, statements, OTHER_TAB);
    return;
  }

  // The rest of this candidate's planned chunks will not run. They are not touched here: each later
  // step drops one of them and opens its rows, so no step reads more than one chunk (M-new-4).
  const writtenIds = new Set(written.map((w) => w.rowId));
  statements.push(
    ctx.db
      .update(ingestMergeChunk)
      .set({ state: "failed", errorCode: failure.code, errorMessage: failure.message.slice(0, MESSAGE_MAX), seq: finishedSeq(run.id) })
      .where(mine),
    ingestAbortUnlessChanged(ctx.db),
    ...requeue(ctx, rows.filter((r) => !writtenIds.has(r.id)).map((r) => r.id)),
  );
  statements.push(
    ...holdStatements(ctx, run, candidateId, chunk.id, failure, at),
    ...advance(ctx, run.id, expectCursor, { chunksFailed: sql`${ingestMergeRun.chunksFailed} + 1` }),
  );
  await guardedBatch(ctx.db, statements, OTHER_TAB);
}

/**
 * Hold a merging candidate with the failure, with an audit row. Its planned chunks that will not
 * run stay planned; the write step drops them one a step and opens their rows (M-new-4). The merge
 * never changes a row's `state`, so the candidate's counts need no recount here.
 */
function holdStatements(ctx: IngestCtx, run: RunRow, candidateId: string, chunkId: string, failure: ChunkFailure, at: Date): SqliteBatchItem[] {
  return [
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
    auditInsert(ctx, {
      action: "ingest.candidate.hold",
      subjectType: "ingest_candidate",
      subjectId: candidateId,
      meta: { reason: failure.reason, detail: failure.message.slice(0, MESSAGE_MAX), code: failure.code, runId: run.id, chunkId },
    }),
  ];
}

async function finish(ctx: IngestCtx, run: RunRow, expectCursor: number): Promise<void> {
  const merging = await ctx.db
    .select({ id: ingestCandidate.id, target: ingestCandidate.target })
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
    );
  }
  statements.push(
    auditInsert(ctx, {
      action: "ingest.merge.finish",
      subjectType: "ingest_merge_run",
      subjectId: run.id,
      meta: { state, merged: merging.length, chunksWritten: fresh.chunksWritten, chunksFailed: fresh.chunksFailed },
    }),
    ...advance(ctx, run.id, expectCursor, { state, finishedAt: at }, { active: true }),
  );
  await guardedBatch(ctx.db, statements, OTHER_TAB);
  // A sheet whose rows named a merged order book checks again: the live-data rule applies now (item 3).
  const { othersAgainAfter } = await import("../dryrun");
  for (const m of merging) {
    const again = await othersAgainAfter(ctx, m, "merged", at);
    if (again.length) await ctx.db.batch(again as never);
  }
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------

export async function stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut> {
  const run = await loadRun(ctx, input.runId);
  if (!ACTIVE.includes(run.state)) return out(run);
  // A chunk in flight (or left sent by a step that crashed) may have landed. Stopping now would
  // reopen its rows for editing while a resend would answer with what landed (B4). The next step
  // finishes it: the same rows with the same keys, recorded as written. Then stop. A stuck chunk
  // (B-new-1) is not waited for: it is marked failed, its candidate held, its rows kept queued.
  const sent = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "sent")));
  const at = now();
  if (sent.some((c) => !isStuck(c, at))) throw new TRPCError({ code: "CONFLICT", message: "A part is still being written. Stop again when it is done." });
  // A stuck chunk moved into this run and not resent yet keeps its rows queued too.
  const moved = await ctx.db
    .select()
    .from(ingestMergeChunk)
    .where(
      and(
        eq(ingestMergeChunk.runId, run.id),
        eq(ingestMergeChunk.companyId, ctx.companyId),
        eq(ingestMergeChunk.state, "planned"),
        eq(ingestMergeChunk.errorCode, STUCK_CODE),
      ),
    );
  // Every other planned chunk is dropped below: its rows open again, by the chunk mark.
  const planned = await ctx.db
    .select({ id: ingestMergeChunk.id })
    .from(ingestMergeChunk)
    .where(
      and(
        eq(ingestMergeChunk.runId, run.id),
        eq(ingestMergeChunk.companyId, ctx.companyId),
        eq(ingestMergeChunk.state, "planned"),
        or(isNull(ingestMergeChunk.errorCode), ne(ingestMergeChunk.errorCode, STUCK_CODE)),
      ),
    );
  const statements: SqliteBatchItem[] = [];
  const stuckCandidates = new Set<string>();
  for (const c of [...sent, ...moved]) {
    statements.push(...stuckStatements(ctx, run, c, at));
    stuckCandidates.add(c.candidateId);
  }
  statements.push(...reopenChunks(ctx, planned.map((c) => c.id)));
  const merging = (
    await ctx.db
      .select({ id: ingestCandidate.id })
      .from(ingestCandidate)
      .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging")))
  ).filter((m) => !stuckCandidates.has(m.id));
  statements.push(
    ctx.db
      .update(ingestMergeRun)
      .set({
        state: "stopped",
        finishedAt: at,
        serverSeq: sql`${ingestMergeRun.serverSeq} + 1`,
        chunksFailed: sql`${ingestMergeRun.chunksFailed} + ${sent.length + moved.length}`,
      })
      .where(
        and(
          eq(ingestMergeRun.id, run.id),
          eq(ingestMergeRun.companyId, ctx.companyId),
          inArray(ingestMergeRun.state, ACTIVE),
          // A step that claimed a chunk since the check above wins; stop is refused.
          sql`not exists (select 1 from ingest_merge_chunk c where c.run_id = ${run.id} and c.state = 'sent')`,
        ),
      ),
    ingestAbortUnlessChanged(ctx.db),
    ctx.db
      .delete(ingestMergeChunk)
      .where(and(eq(ingestMergeChunk.runId, run.id), eq(ingestMergeChunk.companyId, ctx.companyId), eq(ingestMergeChunk.state, "planned"))),
    ctx.db
      .update(ingestMergeRun)
      .set({ chunksTotal: sql`(select count(*) from ingest_merge_chunk c where c.run_id = ${run.id} and not (c.row_count = 0 and c.state = 'written'))` })
      .where(and(eq(ingestMergeRun.id, run.id), eq(ingestMergeRun.companyId, ctx.companyId))),
  );
  for (const m of merging) {
    statements.push(
      ctx.db
        .update(ingestCandidate)
        .set({ state: "approved", serverSeq: sql`${ingestCandidate.serverSeq} + 1`, updatedAt: at })
        .where(and(eq(ingestCandidate.id, m.id), eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging"))),
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
