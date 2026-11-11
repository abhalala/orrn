/**
 * Merge planning (plan A5 step 2): turn the open ready rows of the merging candidates into chunks.
 *
 * - A chunk is a contiguous `row_index` range of one candidate holding only rows in `ready_create`
 *   or `ready_update` with `merge_state = 'open'`. Planned rows become `queued`.
 * - Chunks are numbered by target order (B4), then candidate creation time, then row index.
 * - Rows per chunk follow the plan A5 table. Targets whose updates go through another procedure
 *   than their creates start a new chunk when the row kind changes, so a chunk is all creates or
 *   all updates.
 * - Orders: one order (orderKeyOf) is never cut. Whole orders pack at most 10 per chunk. Orders
 *   that interleave in the file form one component; a component above 10 orders is packed 10
 *   whole orders at a time in order of their first row, so chunk ranges may overlap.
 * - Every planned row carries its chunk's mark (CHUNK_MARK, B-new-2). The write step reads exactly
 *   those rows by an index, whatever the range, and checks the chunk id against them. The order
 *   grouping is worked out here, once, over the whole candidate; a write step reads only its rows.
 * - Before any order is written, an orders candidate is held when an order has more than 100
 *   lines, when one PO has two order dates, or when its PO is already on a live order (B1, B5),
 *   or when a line is one the order screen would refuse (B11). A die copies candidate with a
 *   status an import may not set (B12) and an alias candidate with an alias that is another
 *   customer's or vendor's name (B13) are held the same way, and so is any candidate with a
 *   ready_update row that names no record, or one on bundles or orders, which the merge only adds
 *   to (B6). Planning ends before the first
 *   chunk of the run is written, so these holds land before anything of the candidate is written.
 * - A candidate with nothing open to write gets one empty chunk, already written, so the run
 *   lists it (merged with nothing written).
 * - The chunk id is the call's clientRequestId: `ing-` plus 40 hex of
 *   sha256(candidateId|target|holeRef|rowFrom|rowTo|sha256(rowIds)). Same rows, same id.
 */
import { TARGET_ORDER } from "@orrn/ingest";
import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { ingestCandidate, ingestMergeChunk, ingestStagedRow, type IngestTarget } from "@orrn/db/schema/ingest";
import { salesOrder } from "@orrn/db/schema/sales";

import { chunk as chunkList, mapInChunks, type SqliteBatchItem } from "../../atomic";
import type { CandidateRow } from "../core";
import type { IngestCtx } from "../types";
import { aliasNameOwners, aliasRefusal, handStatusRefusal, ORDER_LINE_FIELDS, orderLineOf, orderPricing, updateRefusal } from "./adapters";
import {
  CHUNK_MARK,
  CHUNK_ROWS,
  companyNotIndexed,
  failureOf,
  LINES_PER_ORDER,
  MESSAGE_MAX,
  ORDERS_PER_CHUNK,
  orderKeyOf,
  rowsRequestId,
  sha256Hex,
  SPLIT_UPDATES,
  text,
  type ChunkFailure,
  type StagedRow,
} from "./shared";

/** Open rows read per planning step for one candidate (orders read the whole candidate). */
export const PLAN_PAGE_ROWS = 2000;

const READY = ["ready_create", "ready_update"] as const;

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

type PlanRow = { id: string; rowIndex: number; state: string; group: string | null; matchId?: string | null };

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
 * components into chunks of at most 10 orders. A component above the cap is packed 10 whole orders
 * at a time, in order of each order's first row. An order is never cut.
 */
export function cutOrderRuns(rows: readonly PlanRow[]): PlanRow[][] {
  const keyOf = (r: PlanRow) => r.group ?? `row:${r.rowIndex}`;
  const span = new Map<string, { from: number; to: number }>();
  for (const r of rows) {
    const g = keyOf(r);
    const s = span.get(g);
    if (s) s.to = r.rowIndex;
    else span.set(g, { from: r.rowIndex, to: r.rowIndex });
  }
  // Components: walk rows in order; a component ends where no open group span reaches further.
  const components: PlanRow[][] = [];
  let cur: PlanRow[] = [];
  let reach = -1;
  for (const r of rows) {
    const s = span.get(keyOf(r))!;
    if (cur.length > 0 && r.rowIndex > reach) {
      components.push(cur);
      cur = [];
    }
    cur.push(r);
    reach = Math.max(reach, s.to);
  }
  if (cur.length) components.push(cur);

  const orderCount = (part: readonly PlanRow[]) => new Set(part.map(keyOf)).size;

  const out: PlanRow[][] = [];
  let pack: PlanRow[] = [];
  const flush = () => {
    if (pack.length) out.push(pack);
    pack = [];
  };
  for (const comp of components) {
    if (orderCount(comp) > ORDERS_PER_CHUNK) {
      flush();
      // Whole orders, 10 at a time, in order of their first row (Map keeps insertion order).
      const byOrder = new Map<string, PlanRow[]>();
      for (const r of comp) {
        const list = byOrder.get(keyOf(r));
        if (list) list.push(r);
        else byOrder.set(keyOf(r), [r]);
      }
      const orders = [...byOrder.values()];
      for (let i = 0; i < orders.length; i += ORDERS_PER_CHUNK) {
        out.push(orders.slice(i, i + ORDERS_PER_CHUNK).flat().sort((a, b) => a.rowIndex - b.rowIndex));
      }
      continue;
    }
    if (pack.length > 0 && orderCount(pack) + orderCount(comp) > ORDERS_PER_CHUNK) flush();
    pack.push(...comp);
  }
  flush();
  return out;
}

/**
 * Whole orders in order of their first row until `rowCount` rows. The write step no longer needs
 * it: it reads a chunk's rows by the chunk mark (B-new-2). Kept as a pure helper with its tests.
 */
export function pickOrderRows(rows: readonly StagedRow[], rowCount: number): StagedRow[] {
  return pickOrders(rows, rowCount, (r) => orderKeyOf((r.values ?? {}) as Record<string, unknown>));
}

/** `pickOrderRows` over any rows with an order key (the write step reads only the keys first). */
export function pickOrders<T extends { rowIndex: number }>(rows: readonly T[], rowCount: number, keyOf: (r: T) => string): T[] {
  const byOrder = new Map<string, T[]>();
  for (const r of [...rows].sort((a, b) => a.rowIndex - b.rowIndex)) {
    const k = keyOf(r);
    const list = byOrder.get(k);
    if (list) list.push(r);
    else byOrder.set(k, [r]);
  }
  const out: T[] = [];
  for (const list of byOrder.values()) {
    if (out.length >= rowCount) break;
    out.push(...list);
  }
  return out.sort((a, b) => a.rowIndex - b.rowIndex);
}

/** The order key of a staged row. Must give the same key as `orderKeyOf` in shared.ts. */
const V = ingestStagedRow.values;
export const ORDER_GROUP_SQL = sql<string>`coalesce(json_extract(${V}, '$._ids.customer'), json_extract(${V}, '$.customer'), '') || char(31) || case when trim(coalesce(json_extract(${V}, '$.poNumber'), '')) <> '' then 'po:' || lower(trim(json_extract(${V}, '$.poNumber'))) else 'old:' || trim(coalesce(json_extract(${V}, '$.oldOrderNo'), '')) || char(31) || coalesce(json_extract(${V}, '$.orderDate'), '') end`;

export type PlanStep =
  | { done: true }
  | {
      done: false;
      candidateId: string;
      chunks: PlannedChunk[];
      statements: SqliteBatchItem[];
      /** Hold the candidate before anything of it is written, with this empty failed chunk. */
      hold?: { chunkId: string; failure: ChunkFailure };
      /** Nothing to write: record this empty chunk as written. */
      empty?: string;
    };

/** The id of an empty chunk (a hold found at planning, or a candidate with nothing to write). */
export async function markerChunkId(runId: string, candidateId: string, kind: "hold" | "empty"): Promise<string> {
  return `ing-${(await sha256Hex([kind, runId, candidateId].join("|"))).slice(0, 40)}`;
}

type OrderPlanRow = PlanRow & {
  customer: string | null;
  po: string | null;
  poText: string | null;
  orderDate: string | null;
  oldNo: string | null;
  hasRate: number | null;
  /** JSON of the fields `orderLineOf` reads (ORDER_LINE_FIELDS). */
  line?: string | null;
};

const hold = (message: string, code = "BAD_REQUEST"): ChunkFailure => ({ code, message: message.slice(0, MESSAGE_MAX), reason: "merge_failed" });

/**
 * Orders a merge must not send (B1, B5): an order above 100 lines, one PO on two order dates, or
 * a PO already on a live order that this order's own replay key did not make; rates staged while
 * the person merging may not write them (B3: a rate is left out only by choice); and a line the
 * order screen would refuse (B11: no weight, balance 0, no cut length, or `orderLineInput`). Found
 * over the whole candidate before any order of it is written.
 */
export async function orderPlanHold(ctx: IngestCtx, rows: readonly OrderPlanRow[]): Promise<ChunkFailure | null> {
  let canPrice = false;
  if (rows.some((r) => r.hasRate)) {
    const price = await orderPricing(ctx);
    if (!price.canPrice) return { code: "FORBIDDEN", message: price.refusal.slice(0, MESSAGE_MAX), reason: "merge_failed" };
    canPrice = true;
  }
  const { orderLineInput } = await import("../../../routers/salesOrder");
  for (const r of rows) {
    if (r.line === undefined) break;
    try {
      // The section is resolved at chunk time (B10); any id passes the schema here.
      orderLineOf(orderLineInput, r.rowIndex, (r.line ? JSON.parse(r.line) : {}) as Record<string, unknown>, "section", canPrice);
    } catch (e) {
      return failureOf(e);
    }
  }
  const groups = new Map<string, OrderPlanRow[]>();
  for (const r of rows) {
    const k = r.group ?? `row:${r.rowIndex}`;
    const list = groups.get(k);
    if (list) list.push(r);
    else groups.set(k, [r]);
  }
  const name = (r: OrderPlanRow) => (r.poText ? `PO ${r.poText}` : r.oldNo ? `Old order ${r.oldNo}` : `The order on file row ${r.rowIndex + 1}`);
  for (const list of groups.values()) {
    const first = list[0]!;
    if (list.length > LINES_PER_ORDER) {
      return hold(`${name(first)} has ${list.length} lines. An order takes ${LINES_PER_ORDER} lines at most. Split it in the file or skip some rows.`);
    }
    const dates = [...new Set(list.map((r) => r.orderDate ?? ""))];
    if (first.po && dates.length > 1) {
      return hold(`${name(first)} has more than one order date in the file (${dates.filter(Boolean).slice(0, 3).join(", ")}). One PO is one order. Fix the dates or skip rows.`);
    }
  }
  // POs already on a live order of the same customer.
  const withPo = [...groups.values()].filter((l) => l[0]!.po && l[0]!.customer && !l[0]!.customer.startsWith("pending:"));
  if (withPo.length === 0) return null;
  const customers = [...new Set(withPo.map((l) => l[0]!.customer!))];
  const live = await mapInChunks(customers, (part) =>
    ctx.db
      .select({ customerId: salesOrder.customerId, po: sql<string>`lower(trim(${salesOrder.poNumber}))`, number: salesOrder.number, requestId: salesOrder.clientRequestId })
      .from(salesOrder)
      .where(
        and(
          eq(salesOrder.companyId, ctx.companyId),
          inArray(salesOrder.customerId, part),
          sql`${salesOrder.poNumber} is not null`,
          sql`${salesOrder.status} <> 'cancelled'`,
        ),
      ),
  );
  if (live.length === 0) return null;
  const taken = new Map<string, { number: string; requestId: string | null }[]>();
  for (const o of live) {
    const k = `${o.customerId}|${o.po}`;
    taken.set(k, [...(taken.get(k) ?? []), o]);
  }
  for (const list of withPo) {
    const first = list[0]!;
    const hits = taken.get(`${first.customer}|${first.po}`);
    if (!hits) continue;
    // The order this very group made before a crash is not a clash: its resend answers replayed.
    const mine = await rowsRequestId(list.map((r) => r.id));
    const other = hits.find((h) => h.requestId !== mine);
    if (other) return hold(`PO ${first.poText} is already on ${other.number} for this customer. Skip these rows or cancel that order first.`);
  }
  return null;
}

const isAlias = (t: IngestTarget): t is "customer_aliases" | "vendor_aliases" => t === "customer_aliases" || t === "vendor_aliases";

/** The fields `orderLineOf` reads, as one JSON object. */
const ORDER_LINE_SQL = sql<string | null>`json_object(${sql.join(
  ORDER_LINE_FIELDS.map((f) => sql`${sql.raw(`'${f}'`)}, json_extract(${V}, ${sql.raw(`'$.${f}'`)})`),
  sql`, `,
)})`;

type RowPlanRow = PlanRow & { status?: unknown; alias?: unknown; owner?: string | null };

/**
 * Rows of a page the adapter would refuse, found before any chunk of the candidate is written:
 * a die copy status an import may not set (B12), and an alias that is already the name of another
 * customer or vendor (B13). An alias whose owner is made in this same run is left to the adapter,
 * which knows the owner's id by then.
 */
export async function rowPlanHold(ctx: IngestCtx, target: IngestTarget, rows: readonly RowPlanRow[]): Promise<ChunkFailure | null> {
  if (target === "die_copies") {
    for (const r of rows) {
      const refusal = handStatusRefusal(r.rowIndex, r.status);
      if (refusal) return hold(refusal);
    }
    return null;
  }
  if (!isAlias(target)) return null;
  const creates = rows.filter((r) => r.state === "ready_create" && r.owner && !r.owner.startsWith("pending:"));
  if (creates.length === 0) return null;
  const owners = await aliasNameOwners(ctx, target);
  for (const r of creates) {
    const refusal = aliasRefusal(r.rowIndex, text(r.alias) ?? "", r.owner!, owners);
    if (refusal) return hold(refusal, "CONFLICT");
  }
  return null;
}

/**
 * Plan one page: the first merging candidate (in merge order) that still has open ready rows, or
 * that has no chunk in this run yet. The caller adds the cursor guard and the run counters to
 * `statements` and runs them in one batch.
 */
export async function planPage(ctx: IngestCtx, runId: string, firstSeq: number): Promise<PlanStep> {
  const seen = new Set(
    (
      await ctx.db
        .selectDistinct({ id: ingestMergeChunk.candidateId })
        .from(ingestMergeChunk)
        .where(and(eq(ingestMergeChunk.runId, runId), eq(ingestMergeChunk.companyId, ctx.companyId)))
    ).map((x) => x.id),
  );
  for (const c of await mergingCandidates(ctx)) {
    if (!c.target) continue;
    const isOrders = c.target === "orders";
    const rows = await ctx.db
      .select({
        id: ingestStagedRow.id,
        rowIndex: ingestStagedRow.rowIndex,
        state: ingestStagedRow.state,
        matchId: ingestStagedRow.matchId,
        group: isOrders ? ORDER_GROUP_SQL : sql<string | null>`null`,
        customer: isOrders ? sql<string | null>`coalesce(json_extract(${V}, '$._ids.customer'), json_extract(${V}, '$.customer'))` : sql<string | null>`null`,
        po: isOrders ? sql<string | null>`nullif(lower(trim(coalesce(json_extract(${V}, '$.poNumber'), ''))), '')` : sql<string | null>`null`,
        poText: isOrders ? sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.poNumber'), '')), '')` : sql<string | null>`null`,
        orderDate: isOrders ? sql<string | null>`json_extract(${V}, '$.orderDate')` : sql<string | null>`null`,
        oldNo: isOrders ? sql<string | null>`nullif(trim(coalesce(json_extract(${V}, '$.oldOrderNo'), '')), '')` : sql<string | null>`null`,
        hasRate: isOrders ? sql<number | null>`json_type(${V}, '$.rate') in ('integer', 'real')` : sql<number | null>`null`,
        line: isOrders ? ORDER_LINE_SQL : sql<string | null>`null`,
        // die_copies: the status the row would set (B12). Aliases: the alias and its owner (B13).
        status: c.target === "die_copies" ? sql<unknown>`case when ${ingestStagedRow.state} = 'ready_update' then json_extract(${ingestStagedRow.diff}, '$.status.file') else json_extract(${V}, '$.status') end` : sql<unknown>`null`,
        alias: isAlias(c.target) ? sql<unknown>`json_extract(${V}, '$.alias')` : sql<unknown>`null`,
        owner: isAlias(c.target)
          ? sql<string | null>`json_extract(${V}, ${c.target === "vendor_aliases" ? "$._ids.vendor" : "$._ids.customer"})`
          : sql<string | null>`null`,
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
    if (rows.length === 0) {
      if (seen.has(c.id)) continue;
      // Nothing to write (every row unchanged, skipped or written before): one empty chunk, written.
      return { done: false, candidateId: c.id, chunks: [], statements: [], empty: await markerChunkId(runId, c.id, "empty") };
    }

    // Planning ends before any chunk of the run is written, so a hold found on any page of a
    // candidate lands before anything of it is written.
    // A ready_update row with no record, or on a target the merge only adds to, is never sent (B6).
    const update = rows.map((r) => updateRefusal(c.target!, { state: r.state as StagedRow["state"], matchId: r.matchId, rowIndex: r.rowIndex })).find(Boolean);
    const failure = update ? hold(update) : isOrders ? await orderPlanHold(ctx, rows) : await rowPlanHold(ctx, c.target, rows);
    if (failure) return { done: false, candidateId: c.id, chunks: [], statements: [], hold: { chunkId: await markerChunkId(runId, c.id, "hold"), failure } };

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
    // Each row carries its chunk's mark, so the write step reads exactly its rows (B-new-2).
    for (const ch of chunks) {
      for (const part of chunkList(ch.rowIds, 90)) {
        statements.push(
          ctx.db
            .update(ingestStagedRow)
            .set({ mergeState: "queued", committedType: CHUNK_MARK, committedId: ch.id })
            .where(and(companyNotIndexed(ingestStagedRow.companyId, ctx.companyId), inArray(ingestStagedRow.id, part), eq(ingestStagedRow.mergeState, "open"))),
        );
      }
    }
    return { done: false, candidateId: c.id, chunks, statements };
  }
  return { done: true };
}
