/**
 * Merge planning (plan A5 step 2): turn the open ready rows of the merging candidates into chunks.
 *
 * - A chunk is a contiguous `row_index` range of one candidate holding only rows in `ready_create`
 *   or `ready_update` with `merge_state = 'open'`. Planned rows become `queued`.
 * - Chunks are numbered by target order (B4), then candidate creation time, then row index.
 * - Rows per chunk follow the plan A5 table. Targets whose updates go through another procedure
 *   than their creates start a new chunk when the row kind changes, so a chunk is all creates or
 *   all updates.
 * - Orders: rows of one order (customer + PO or old order number + date) stay in one chunk when the
 *   orders do not interleave; at most 10 orders per chunk. Interleaved orders past that cap are cut
 *   at a row boundary, and an order cut that way becomes two orders.
 * - The chunk id is the call's clientRequestId: `ing-` plus 40 hex of
 *   sha256(candidateId|target|holeRef|rowFrom|rowTo|sha256(rowIds)). Same rows, same id.
 */
import { TARGET_ORDER } from "@orrn/ingest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ingestCandidate, ingestMergeChunk, ingestStagedRow, type IngestTarget } from "@orrn/db/schema/ingest";

import { chunk as chunkList, type SqliteBatchItem } from "../../atomic";
import type { CandidateRow } from "../core";
import type { IngestCtx } from "../types";
import { CHUNK_ROWS, LINES_PER_ORDER, ORDERS_PER_CHUNK, SPLIT_UPDATES } from "./shared";

/** Open rows read per planning step for one candidate (orders read the whole candidate). */
export const PLAN_PAGE_ROWS = 2000;

const READY = ["ready_create", "ready_update"] as const;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function chunkIdOf(input: {
  candidateId: string;
  target: IngestTarget;
  holeRef: string | null;
  rowFrom: number;
  rowTo: number;
  rowIds: readonly string[];
}): Promise<string> {
  const rowsHash = await sha256Hex(input.rowIds.join("|"));
  const h = await sha256Hex(
    [input.candidateId, input.target, input.holeRef ?? "", input.rowFrom, input.rowTo, rowsHash].join("|"),
  );
  return `ing-${h.slice(0, 40)}`;
}

/** Merging candidates of the plant in merge order. One run is active per plant, so they are this run's. */
export async function mergingCandidates(ctx: Pick<IngestCtx, "db" | "companyId">): Promise<CandidateRow[]> {
  const rows = await ctx.db
    .select()
    .from(ingestCandidate)
    .where(and(eq(ingestCandidate.companyId, ctx.companyId), eq(ingestCandidate.state, "merging")));
  const rank = (t: IngestTarget | null) => (t ? TARGET_ORDER.indexOf(t) : 99);
  return rows.sort(
    (a, b) =>
      rank(a.target) - rank(b.target) ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

type PlanRow = { id: string; rowIndex: number; state: string; group: string | null };

export type PlannedChunk = { id: string; rowFrom: number; rowTo: number; rowIds: string[] };

/** Contiguous runs, cut at the size limit and, for split targets, where the row kind changes. */
export function cutRuns(target: IngestTarget, rows: readonly PlanRow[]): PlanRow[][] {
  const out: PlanRow[][] = [];
  let cur: PlanRow[] = [];
  const limit = (r: PlanRow) => (r.state === "ready_update" ? CHUNK_ROWS[target].update : CHUNK_ROWS[target].create);
  for (const r of rows) {
    const kindChanged = SPLIT_UPDATES.has(target) && cur.length > 0 && cur[0]!.state !== r.state;
    if (cur.length > 0 && (kindChanged || cur.length >= limit(cur[0]!))) {
      out.push(cur);
      cur = [];
    }
    cur.push(r);
  }
  if (cur.length) out.push(cur);
  return out;
}

/**
 * Orders: group rows by order key; join groups whose row spans overlap into components; pack whole
 * components into chunks of at most 10 orders. A component above the cap is cut by rows.
 */
export function cutOrderRuns(rows: readonly PlanRow[]): PlanRow[][] {
  const span = new Map<string, { from: number; to: number }>();
  for (const r of rows) {
    const g = r.group ?? `row:${r.rowIndex}`;
    const s = span.get(g);
    if (s) s.to = r.rowIndex;
    else span.set(g, { from: r.rowIndex, to: r.rowIndex });
  }
  // Components: walk rows in order; a component ends where no open group span reaches further.
  const components: PlanRow[][] = [];
  let cur: PlanRow[] = [];
  let reach = -1;
  for (const r of rows) {
    const s = span.get(r.group ?? `row:${r.rowIndex}`)!;
    if (cur.length > 0 && r.rowIndex > reach) {
      components.push(cur);
      cur = [];
    }
    cur.push(r);
    reach = Math.max(reach, s.to);
  }
  if (cur.length) components.push(cur);

  const orderCount = (part: readonly PlanRow[]) => {
    // An order above 100 lines is sent as several orders (plan A5: 100 lines at most per order).
    const lines = new Map<string, number>();
    for (const r of part) {
      const g = r.group ?? `row:${r.rowIndex}`;
      lines.set(g, (lines.get(g) ?? 0) + 1);
    }
    let n = 0;
    for (const c of lines.values()) n += Math.ceil(c / LINES_PER_ORDER);
    return n;
  };

  const out: PlanRow[][] = [];
  let pack: PlanRow[] = [];
  const flush = () => {
    if (pack.length) out.push(pack);
    pack = [];
  };
  for (const comp of components) {
    if (orderCount(comp) > ORDERS_PER_CHUNK) {
      flush();
      // Cut by rows: start a new chunk when one more row would make an 11th order.
      let part: PlanRow[] = [];
      let lines = new Map<string, number>();
      let orders = 0;
      for (const r of comp) {
        const g = r.group ?? `row:${r.rowIndex}`;
        const had = lines.get(g) ?? 0;
        const more = had % LINES_PER_ORDER === 0 ? 1 : 0;
        if (part.length > 0 && orders + more > ORDERS_PER_CHUNK) {
          out.push(part);
          part = [];
          lines = new Map();
          orders = 0;
        }
        const now = lines.get(g) ?? 0;
        if (now % LINES_PER_ORDER === 0) orders += 1;
        lines.set(g, now + 1);
        part.push(r);
      }
      if (part.length) out.push(part);
      continue;
    }
    if (pack.length > 0 && orderCount(pack) + orderCount(comp) > ORDERS_PER_CHUNK) flush();
    pack.push(...comp);
  }
  flush();
  return out;
}

/** The order key of a staged row: customer + (PO or old order number) + order date. */
export const ORDER_GROUP_SQL = sql<string>`coalesce(json_extract(${ingestStagedRow.values}, '$._ids.customer'), json_extract(${ingestStagedRow.values}, '$.customer'), '') || char(31) || coalesce(nullif(json_extract(${ingestStagedRow.values}, '$.poNumber'), ''), nullif(json_extract(${ingestStagedRow.values}, '$.oldOrderNo'), ''), '') || char(31) || coalesce(json_extract(${ingestStagedRow.values}, '$.orderDate'), '')`;

export type PlanStep =
  | { done: true }
  | { done: false; candidateId: string; chunks: PlannedChunk[]; statements: SqliteBatchItem[] };

/**
 * Plan one page: the first merging candidate (in merge order) that still has open ready rows. The
 * caller adds the cursor guard and the run counters to `statements` and runs them in one batch.
 */
export async function planPage(ctx: IngestCtx, runId: string, firstSeq: number): Promise<PlanStep> {
  for (const c of await mergingCandidates(ctx)) {
    if (!c.target) continue;
    const isOrders = c.target === "orders";
    const rows: PlanRow[] = await ctx.db
      .select({
        id: ingestStagedRow.id,
        rowIndex: ingestStagedRow.rowIndex,
        state: ingestStagedRow.state,
        group: isOrders ? ORDER_GROUP_SQL : sql<string | null>`null`,
      })
      .from(ingestStagedRow)
      .where(
        and(
          eq(ingestStagedRow.candidateId, c.id),
          eq(ingestStagedRow.companyId, ctx.companyId),
          inArray(ingestStagedRow.state, [...READY]),
          eq(ingestStagedRow.mergeState, "open"),
        ),
      )
      .orderBy(asc(ingestStagedRow.rowIndex))
      .limit(isOrders ? 50_000 : PLAN_PAGE_ROWS);
    if (rows.length === 0) continue;

    const runs = isOrders ? cutOrderRuns(rows) : cutRuns(c.target, rows);
    const chunks: PlannedChunk[] = [];
    for (const run of runs) {
      const rowIds = run.map((r) => r.id);
      const rowFrom = run[0]!.rowIndex;
      const rowTo = run.at(-1)!.rowIndex;
      chunks.push({ id: await chunkIdOf({ candidateId: c.id, target: c.target, holeRef: c.holeRef, rowFrom, rowTo, rowIds }), rowFrom, rowTo, rowIds });
    }

    const statements: SqliteBatchItem[] = [];
    chunks.forEach((ch, i) => {
      const values = {
        id: ch.id,
        companyId: ctx.companyId,
        runId,
        candidateId: c.id,
        target: c.target!,
        seq: firstSeq + i,
        rowFrom: ch.rowFrom,
        rowTo: ch.rowTo,
        rowCount: ch.rowIds.length,
        state: "planned" as const,
        attempts: 0,
        errorCode: null,
        errorMessage: null,
        sentAt: null,
        writtenAt: null,
      };
      // A chunk that failed in an earlier run and comes back unchanged keeps its id (and so its
      // replay key); it moves to this run.
      const { id: _id, companyId: _c, ...again } = values;
      statements.push(ctx.db.insert(ingestMergeChunk).values(values).onConflictDoUpdate({ target: ingestMergeChunk.id, set: again }));
    });
    for (const part of chunkList(chunks.flatMap((ch) => ch.rowIds), 90)) {
      statements.push(
        ctx.db
          .update(ingestStagedRow)
          .set({ mergeState: "queued" })
          .where(and(eq(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part), eq(ingestStagedRow.mergeState, "open"))),
      );
    }
    return { done: false, candidateId: c.id, chunks, statements };
  }
  return { done: true };
}
