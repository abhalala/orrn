/**
 * XE store (rows 69 to 72): shared statements for indents and store purchase orders. The routers are
 * `routers/storeIndent.ts` and `routers/storePo.ts` (nested under `store`); `store.receive` and
 * `store.cancel` use the PO pieces here so a GRN against an order and its cancel keep the order's status.
 */
import { TRPCError } from "@trpc/server";
import { and, eq, sql, type SQL } from "drizzle-orm";

import { storeTxn } from "@orrn/db/schema/store";
import { storeIndentLine, storePo, storePoLine } from "@orrn/db/schema/storeBuy";
import { company } from "@orrn/db/schema/tenant";
import { readPoOverReceiptBp } from "@orrn/domain";

import type { OrrnDb, SqliteBatchItem } from "./atomic";

/** The settings key of the plant's over-receipt tolerance on PO lines (basis points). */
export const PO_TOLERANCE_KEY = "storePoOverReceiptBp";

export async function readPoTolerance(db: OrrnDb, companyId: string): Promise<number> {
  const [row] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  const raw = (row?.settings as Record<string, unknown> | null)?.[PO_TOLERANCE_KEY];
  return readPoOverReceiptBp(raw);
}

/** Accepted quantity received on a PO line over its live GRNs (milli-units), as a scalar subquery. */
export function poLineReceivedSql(companyId: string, lineIdSql: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(r.qty_milli) from ${storeTxn} r
    where r.company_id = ${companyId} and r.po_line_id = ${lineIdSql} and r.kind = 'grn' and r.cancelled_at is null
  ), 0)`;
}

/**
 * Any live GRN that took goods in against any line of the order (correlated on `poIdSql`). A fully
 * rejected delivery (accepted 0) is a record only: it neither moves the order to part received nor
 * stops its cancel.
 */
export function poHasLiveGrnSql(companyId: string, poIdSql: SQL): SQL {
  return sql`exists (
    select 1 from ${storeTxn} r
    join ${storePoLine} pl on pl.id = r.po_line_id and pl.company_id = r.company_id
    where r.company_id = ${companyId} and pl.po_id = ${poIdSql} and r.kind = 'grn' and r.cancelled_at is null
      and r.qty_milli > 0
  )`;
}

/**
 * The order (alias) was closed short by hand. `store.po.close` is the only writer of `close_note` and
 * always sets it (a note is required), so the note is the close kind; `closed_by` is a person, and
 * deleting that person sets it to null, so it alone cannot say how the order closed (CodeRabbit round 4).
 */
export function poClosedByHandSql(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.close_note is not null or ${a}.closed_by is not null)`;
}

/**
 * The order (alias) takes deliveries: issued, part received, or closed by a full delivery (not by hand),
 * so a late top-up within the tolerance still lands (`poTakesDeliveries` in @orrn/domain).
 */
export function poTakesDeliveriesSql(alias: string): SQL {
  const a = sql.raw(alias);
  return sql`(${a}.status in ('issued', 'part_received') or (${a}.status = 'closed' and not ${poClosedByHandSql(alias)}))`;
}

/**
 * The indent row `indentAlias` (in scope) covers the item `itemIdSql`: the item is on it, and the indent
 * is open or approved, or ordered while its order is draft, issued or part received AND that order has a
 * line for the item. An item the order left out is not on order, so it stays reorderable (CodeRabbit
 * round 4). One predicate for `store.indents.fromReorder` (read and write time) and `store.belowMinimum`.
 */
export function indentCoversItemSql(companyId: string, indentAlias: string, itemIdSql: SQL): SQL {
  const ci = sql.raw(indentAlias);
  return sql`(${ci}.company_id = ${companyId}
    and exists (select 1 from ${storeIndentLine} cl where cl.indent_id = ${ci}.id and cl.company_id = ${ci}.company_id and cl.item_id = ${itemIdSql})
    and (${ci}.status in ('open', 'approved') or (${ci}.status = 'ordered' and exists (
      select 1 from ${storePo} cp
      join ${storePoLine} cpl on cpl.po_id = cp.id and cpl.company_id = cp.company_id
      where cp.id = ${ci}.po_id and cp.company_id = ${ci}.company_id
        and cp.status in ('draft', 'issued', 'part_received') and cpl.item_id = ${itemIdSql}
    ))))`;
}

/**
 * Write-time guard for a GRN against a PO line (the GRN INSERT's own WHERE): the line is this plant's,
 * for this item, its order takes deliveries (`poTakesDeliveriesSql`), and the accepted quantity with this delivery
 * stays within ordered + floor(ordered x tolerance / 10 000) (SQLite integer division floors, as
 * `maxReceivableMilli` does).
 */
export function poLineReceiveGuard(input: {
  companyId: string;
  poLineId: string;
  itemId: string;
  qtyMilli: number;
  toleranceBp: number;
}): SQL {
  const { companyId } = input;
  return sql`exists (
    select 1 from ${storePoLine} gl
    join ${storePo} gp on gp.id = gl.po_id and gp.company_id = gl.company_id
    where gl.id = ${input.poLineId} and gl.company_id = ${companyId} and gl.item_id = ${input.itemId}
      and ${poTakesDeliveriesSql("gp")}
      and ${poLineReceivedSql(companyId, sql`gl.id`)} + ${input.qtyMilli}
        <= gl.qty_milli + (gl.qty_milli * ${input.toleranceBp}) / 10000
  )`;
}

/**
 * Bring an order's status in line with what its lines received (`poStatusFromReceipts`): issued, part
 * received or closed. Touches only an order that is issued, part received, or closed by a full delivery
 * (not `poClosedByHandSql`); a short close by hand, a draft and a cancelled order keep their status. Put it
 * after the GRN insert or the cancel mark in the same batch.
 */
export function poStatusSync(db: OrrnDb, input: { companyId: string; poId: string; seq: number; at: Date }): SqliteBatchItem {
  const { companyId } = input;
  const short = sql`exists (
    select 1 from ${storePoLine} sl
    where sl.po_id = ${storePo.id} and sl.company_id = ${companyId}
      and ${poLineReceivedSql(companyId, sql`sl.id`)} < sl.qty_milli
  )`;
  const any = poHasLiveGrnSql(companyId, sql`${storePo.id}`);
  const next = sql<string>`(case when not ${short} then 'closed' when ${any} then 'part_received' else 'issued' end)`;
  return db
    .update(storePo)
    .set({
      status: next as never,
      closedAt: sql`(case when ${next} = 'closed' then coalesce(${storePo.closedAt}, ${input.at.getTime()}) else null end)` as never,
      serverSeq: input.seq,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(storePo.id, input.poId),
        eq(storePo.companyId, companyId),
        sql`(${storePo.status} in ('issued', 'part_received') or (${storePo.status} = 'closed' and not ${poClosedByHandSql("store_po")}))`,
      ),
    );
}

export type PoLineForReceipt = {
  lineId: string;
  poId: string;
  poNumber: string;
  poStatus: string;
  /** Closed short by hand (no more deliveries); an order closed by a full delivery still takes top-ups. */
  poClosedByHand: boolean;
  line: number;
  itemId: string;
  orderedMilli: number;
  ratePaise: number;
  receivedMilli: number;
};

export async function loadPoLineForReceipt(db: OrrnDb, companyId: string, poLineId: string): Promise<PoLineForReceipt> {
  const [row] = await db
    .select({
      lineId: storePoLine.id,
      poId: storePo.id,
      poNumber: storePo.number,
      poStatus: storePo.status,
      poClosedByHand: sql<number>`(case when ${poClosedByHandSql("store_po")} then 1 else 0 end)`,
      line: storePoLine.line,
      itemId: storePoLine.itemId,
      orderedMilli: storePoLine.qtyMilli,
      ratePaise: storePoLine.ratePaise,
      receivedMilli: poLineReceivedSql(companyId, sql`${storePoLine.id}`),
    })
    .from(storePoLine)
    .innerJoin(storePo, and(eq(storePo.id, storePoLine.poId), eq(storePo.companyId, storePoLine.companyId)))
    .where(and(eq(storePoLine.id, poLineId), eq(storePoLine.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Purchase order line not found" });
  return { ...row, poClosedByHand: Number(row.poClosedByHand) === 1, receivedMilli: Number(row.receivedMilli) };
}

/** Plant day `YYYY-MM-DD`, checked as a real calendar date. */
export function isPlantDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
