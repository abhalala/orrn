/**
 * Q36 decided (owner 2026-10-24, Q40): a bundle on a dispatch whose kg/12ft is more than 0.1 off its
 * ORDER LINE's kg/12ft needs a second person. Each such row opens one `dispatch_off_band` approval
 * (subject = the dispatch item, approvers owner/admin/manager, never the requester), and
 * `dispatch.complete` refuses while any off-band row of the dispatch is not approved for the line it is
 * on now. A rejected row has to come off the dispatch (or move to a line it fits) before it can leave.
 *
 * The request is opened where the row becomes off band: the add paths (scan, paste, search, one bundle),
 * `dispatch.linkItem`, and `dispatch.complete` (a relink or a customer change can make a row off band
 * without anybody adding it). Meta carries ids, serial, order and line numbers and kg/12ft only.
 */
import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { approval } from "@orrn/db/schema/approval";
import { dispatchItem } from "@orrn/db/schema/dispatch";
import { bundle } from "@orrn/db/schema/inventory";
import { salesOrder, salesOrderLine } from "@orrn/db/schema/sales";
import { bundleKgPer12ftMilli, offLineBand } from "@orrn/domain";

import { mapInChunks, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { requestApprovalInsert } from "./approval";

/** One off-band row: the item, its bundle and the line it is linked to, with both kg/12ft in milli. */
export type OffBandRow = {
  itemId: string;
  bundleId: string;
  serial: string;
  lineId: string;
  orderNumber: string;
  lineNo: number;
  bundleMilli: number;
  lineMilli: number;
  diffMilli: number;
};

/** Where an off-band row stands: asked and waiting, approved, rejected, or not asked yet (a relink made it off band). */
export type OffBandStatus = "pending" | "approved" | "rejected" | "none";

/** The figures an item's bundle has, enough to say whether it is off its line. */
export type OffBandInput = {
  itemId: string;
  bundleId: string;
  serial: string;
  bundleMilli: number | null;
  weightG: number;
  quantity: number;
  lengthMm: number;
  line: { lineId: string; orderNumber: string; lineNo: number; kgPer12ftMilli: number | null } | null;
};

/** The off-band row of one item, or null when it is within 0.1 of its line (or has no line or no figures). */
export function offBandRowOf(it: OffBandInput): OffBandRow | null {
  if (!it.line) return null;
  const own = it.bundleMilli ?? bundleKgPer12ftMilli({ weightG: it.weightG, pieces: it.quantity, lengthMm: it.lengthMm });
  const band = offLineBand(own, it.line.kgPer12ftMilli);
  if (!band?.off || own === null || it.line.kgPer12ftMilli === null) return null;
  return {
    itemId: it.itemId,
    bundleId: it.bundleId,
    serial: it.serial,
    lineId: it.line.lineId,
    orderNumber: it.line.orderNumber,
    lineNo: it.line.lineNo,
    bundleMilli: own,
    lineMilli: it.line.kgPer12ftMilli,
    diffMilli: band.diffMilli,
  };
}

/** The items of a dispatch that are off their line now (read fresh; `itemIds` narrows to some items). */
export async function offBandRows(db: OrrnDb, companyId: string, dispatchId: string, itemIds?: readonly string[]): Promise<OffBandRow[]> {
  const rows = await db
    .select({
      itemId: dispatchItem.id,
      bundleId: dispatchItem.bundleId,
      serial: bundle.serial,
      bundleMilli: bundle.kgPer12ftMilli,
      weightG: bundle.weightG,
      quantity: bundle.quantity,
      lengthMm: bundle.lengthMm,
      lineId: salesOrderLine.id,
      lineNo: salesOrderLine.lineNo,
      lineMilli: salesOrderLine.kgPer12ftMilli,
      orderNumber: salesOrder.number,
    })
    .from(dispatchItem)
    .innerJoin(bundle, and(eq(bundle.id, dispatchItem.bundleId), eq(bundle.companyId, companyId)))
    .innerJoin(salesOrderLine, and(eq(salesOrderLine.id, dispatchItem.salesOrderLineId), eq(salesOrderLine.companyId, companyId)))
    .innerJoin(salesOrder, and(eq(salesOrder.id, salesOrderLine.salesOrderId), eq(salesOrder.companyId, companyId)))
    .where(and(eq(dispatchItem.companyId, companyId), eq(dispatchItem.dispatchId, dispatchId)));
  const wanted = itemIds ? new Set(itemIds) : null;
  return rows.flatMap((r) => {
    if (wanted && !wanted.has(r.itemId)) return [];
    const row = offBandRowOf({
      itemId: r.itemId,
      bundleId: r.bundleId,
      serial: r.serial,
      bundleMilli: r.bundleMilli,
      weightG: Number(r.weightG),
      quantity: Number(r.quantity),
      lengthMm: Number(r.lengthMm),
      line: { lineId: r.lineId, orderNumber: r.orderNumber, lineNo: r.lineNo, kgPer12ftMilli: r.lineMilli },
    });
    return row ? [row] : [];
  });
}

/** An item's requests, newest first. */
type ItemRequest = {
  id: string;
  status: "pending" | "approved" | "rejected";
  lineId: string | null;
  /** The bundle's and the line's kg/12ft the request was asked with (review finding 2). */
  bundleMilli: number | null;
  lineMilli: number | null;
};

async function requestsOf(db: OrrnDb, companyId: string, itemIds: readonly string[]): Promise<Map<string, ItemRequest[]>> {
  const out = new Map<string, ItemRequest[]>();
  if (itemIds.length === 0) return out;
  const rows = await mapInChunks([...itemIds], (ids) =>
    db
      .select({ id: approval.id, subjectId: approval.subjectId, status: approval.status, meta: approval.meta, createdAt: approval.createdAt })
      .from(approval)
      .where(and(eq(approval.companyId, companyId), eq(approval.kind, "dispatch_off_band"), inArray(approval.subjectId, ids)))
      .orderBy(desc(approval.createdAt)),
  );
  rows.sort((a, b) => Number(b.createdAt) - Number(a.createdAt));
  for (const r of rows) {
    const lineId = typeof r.meta?.lineId === "string" ? r.meta.lineId : null;
    const milli = (v: unknown) => (typeof v === "number" ? v : null);
    const list = out.get(r.subjectId) ?? [];
    list.push({ id: r.id, status: r.status, lineId, bundleMilli: milli(r.meta?.bundleMilli), lineMilli: milli(r.meta?.lineMilli) });
    out.set(r.subjectId, list);
  }
  return out;
}

/** Whether a request was asked with the kg/12ft the row has now. */
function sameFigures(q: Pick<ItemRequest, "bundleMilli" | "lineMilli">, r: Pick<OffBandRow, "bundleMilli" | "lineMilli">): boolean {
  return q.bundleMilli === r.bundleMilli && q.lineMilli === r.lineMilli;
}

/** Each off-band row with where it stands for the line it is on NOW, and any pending request asked for another line. */
export type OffBandState = OffBandRow & { status: OffBandStatus; approvalId: string | null; stalePendingId: string | null };

export async function offBandStates(db: OrrnDb, companyId: string, rows: readonly OffBandRow[]): Promise<OffBandState[]> {
  const requests = await requestsOf(
    db,
    companyId,
    rows.map((r) => r.itemId),
  );
  return rows.map((r) => {
    const list = requests.get(r.itemId) ?? [];
    const newest = list.find((q) => q.lineId === r.lineId) ?? null;
    // Review finding 2: an approval covers the weights it was given for. Once the line's (or the
    // bundle's) kg/12ft changed, the row is not approved any more and Complete asks again.
    const forLine = newest?.status === "approved" && !sameFigures(newest, r) ? null : newest;
    const stale = list.find((q) => q.status === "pending" && q.lineId !== r.lineId) ?? null;
    return { ...r, status: forLine?.status ?? "none", approvalId: forLine?.id ?? null, stalePendingId: stale?.id ?? null };
  });
}

/** The counts the dispatch screen and the Complete button read: rows waiting, rows rejected, rows not asked yet. */
export function offBandSummary(states: readonly Pick<OffBandState, "status">[]) {
  const count = (s: OffBandStatus) => states.filter((x) => x.status === s).length;
  const pending = count("pending");
  const rejected = count("rejected");
  const unasked = count("none");
  return { pending, rejected, unasked, approved: count("approved"), blocked: pending + rejected > 0 };
}

export type OffBandCtx = {
  db: OrrnDb;
  companyId: string;
  session: { user: { id: string } };
};

/**
 * One `dispatch_off_band` request per row. Each lands only while the item is still on this dispatch
 * AND linked to the line the request names (a suggestion dropped in the same batch lands nothing).
 * `withdraw` names pending requests that asked for another line: they are withdrawn first.
 */
export function offBandRequestStatements(
  ctx: OffBandCtx,
  d: { id: string; code: string },
  rows: readonly OffBandRow[],
  seq: number,
  withdraw: readonly string[] = [],
): SqliteBatchItem[] {
  const statements: SqliteBatchItem[] = [];
  if (withdraw.length > 0) {
    statements.push(
      ctx.db
        .update(approval)
        .set({ status: "rejected", decidedAt: new Date(), note: "Withdrawn: the bundle is on another order line now.", serverSeq: seq })
        .where(and(eq(approval.companyId, ctx.companyId), eq(approval.kind, "dispatch_off_band"), inArray(approval.id, [...withdraw]), eq(approval.status, "pending"))),
    );
  }
  for (const r of rows) {
    statements.push(
      requestApprovalInsert(ctx, {
        kind: "dispatch_off_band",
        subjectId: r.itemId,
        serverSeq: seq,
        meta: {
          dispatchId: d.id,
          dispatchCode: d.code,
          itemId: r.itemId,
          bundleId: r.bundleId,
          serial: r.serial,
          lineId: r.lineId,
          orderNumber: r.orderNumber,
          lineNo: r.lineNo,
          bundleMilli: r.bundleMilli,
          lineMilli: r.lineMilli,
          diffMilli: r.diffMilli,
        },
        guard: {
          from: dispatchItem,
          where: and(
            eq(dispatchItem.companyId, ctx.companyId),
            eq(dispatchItem.id, r.itemId),
            eq(dispatchItem.dispatchId, d.id),
            eq(dispatchItem.salesOrderLineId, r.lineId),
            // Never a second pending request for the same item (the unique index would fail the batch).
            sql`not exists (select 1 from approval pa where pa.company_id = ${ctx.companyId} and pa.kind = 'dispatch_off_band' and pa.subject_id = ${r.itemId} and pa.status = 'pending')`,
          ),
        },
      }).statement,
    );
  }
  return statements;
}

/** True (SQL) while no off-band request of an item on this dispatch is still waiting: the completing UPDATE's guard. */
export function noPendingOffBandSql(companyId: string, dispatchId: string): SQL {
  return sql`not exists (select 1 from approval oba join dispatch_item obi on obi.id = oba.subject_id and obi.company_id = ${companyId} where oba.company_id = ${companyId} and oba.kind = 'dispatch_off_band' and oba.status = 'pending' and obi.dispatch_id = ${dispatchId})`;
}

/**
 * Close the open off-band requests that are moot: the item came off the dispatch (`itemId`), or the
 * whole dispatch completed, was cancelled or deleted (`dispatchId`). Same convention as the overdraw:
 * `rejected` with no decider and a note "Withdrawn: ...". Lands only if `guard` holds.
 */
export function withdrawOffBandStatement(
  db: OrrnDb,
  companyId: string,
  by: { dispatchId: string } | { itemId: string },
  seq: number,
  at: Date,
  why: string,
  guard?: SQL,
): SqliteBatchItem {
  return db
    .update(approval)
    .set({ status: "rejected", decidedAt: at, note: `Withdrawn: ${why}`, serverSeq: seq })
    .where(
      and(
        eq(approval.companyId, companyId),
        eq(approval.kind, "dispatch_off_band"),
        eq(approval.status, "pending"),
        "itemId" in by ? eq(approval.subjectId, by.itemId) : sql`json_extract(${approval.meta}, '$.dispatchId') = ${by.dispatchId}`,
        guard,
      ),
    );
}
