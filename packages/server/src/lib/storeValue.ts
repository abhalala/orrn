/**
 * XE store (row 73): store valuation at the weighted average rate.
 *
 * Every `store_txn` row freezes the money it moved in `value_paise` (always >= 0, sign from `kind`) and
 * how much of its quantity carries that money in `rated_milli`. The average is value held over RATED
 * quantity held, so stock with no rate (old GRNs from before valuation, a pending GRN that had no
 * average to borrow) never pulls it down. An opening rate (`store_opening_rate`) rates the unrated stock
 * held at that moment.
 *
 * - GRN with a rate: quantity x rate, all rated.
 * - GRN with its rate pending: valued at the average when it came in, all rated, so the average does
 *   not move; with nothing rated held it comes in unrated at 0 (`pendingGrnSql`).
 * - MRS: takes rated stock first, valued at the average, inside its own INSERT (`storeTxnInsert` uses
 *   `issueTakeSql`), so the melt's and the nitriding log's draws, MAINT's issues and the store screen's
 *   issues are valued the same way and a racing GRN cannot misvalue an issue.
 *
 * A GRN cannot be cancelled, nor its pending rate set, once anything went out of the item after it
 * (`storeOutSinceSql`), so no frozen issue value is ever left pointing at money that is gone: held value
 * never goes below 0 and nothing is clamped. Held figures are plain sums over live (not cancelled) rows.
 * The formulas are the ones in `@orrn/domain` (`issueTake`, `pendingGrnTake`); `store-xe.test.ts` runs
 * both on the same examples.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";

import { storeTxn } from "@orrn/db/schema/store";
import { storeOpeningRate } from "@orrn/db/schema/storeBuy";

import type { OrrnDb } from "./atomic";

/** Held quantity of an item over its live entries (milli-units, every store location). */
export function storeHeldQtySql(companyId: string, itemIdSql: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(case when h.kind = 'grn' then h.qty_milli else -h.qty_milli end) from ${storeTxn} h
    where h.company_id = ${companyId} and h.item_id = ${itemIdSql} and h.cancelled_at is null
  ), 0)`;
}

/** Rated quantity held: live entries' rated parts plus every opening rate's quantity (milli-units). */
export function storeRatedQtySql(companyId: string, itemIdSql: SQL): SQL<number> {
  return sql<number>`(coalesce((
    select sum(case when h.kind = 'grn' then h.rated_milli else -h.rated_milli end) from ${storeTxn} h
    where h.company_id = ${companyId} and h.item_id = ${itemIdSql} and h.cancelled_at is null
  ), 0) + coalesce((
    select sum(o.qty_milli) from ${storeOpeningRate} o where o.company_id = ${companyId} and o.item_id = ${itemIdSql}
  ), 0))`;
}

/** Held value: live entries' values plus every opening rate's value (paise; never below 0). */
export function storeHeldValueSql(companyId: string, itemIdSql: SQL): SQL<number> {
  return sql<number>`(coalesce((
    select sum(case when h.kind = 'grn' then h.value_paise else -h.value_paise end) from ${storeTxn} h
    where h.company_id = ${companyId} and h.item_id = ${itemIdSql} and h.cancelled_at is null
  ), 0) + coalesce((
    select sum(o.value_paise) from ${storeOpeningRate} o where o.company_id = ${companyId} and o.item_id = ${itemIdSql}
  ), 0))`;
}

/**
 * An issue of `qtyMilli` at the moment the statement runs (`issueTake` in SQL): its rated part (rated
 * stock first, at most what is rated) and its value (value x part / rated in floating point; all the
 * value when it takes all the rated stock; 0 with nothing rated or valued).
 */
export function issueTakeSql(companyId: string, itemIdSql: SQL, qtyMilli: number): { rated: SQL<number>; value: SQL<number> } {
  const r = storeRatedQtySql(companyId, itemIdSql);
  const v = storeHeldValueSql(companyId, itemIdSql);
  return {
    rated: sql<number>`(case when ${r} <= 0 then 0 when ${qtyMilli} >= ${r} then ${r} else ${qtyMilli} end)`,
    value: sql<number>`(case
      when ${r} <= 0 or ${v} <= 0 then 0
      when ${qtyMilli} >= ${r} then ${v}
      else max(0, cast(round(${v} * 1.0 * ${qtyMilli} / ${r}) as integer))
    end)`,
  };
}

/** A pending GRN of `qtyMilli` (`pendingGrnTake` in SQL): at the average, all rated; unrated at 0 with no average. */
export function pendingGrnSql(companyId: string, itemIdSql: SQL, qtyMilli: number): { rated: SQL<number>; value: SQL<number> } {
  const r = storeRatedQtySql(companyId, itemIdSql);
  const v = storeHeldValueSql(companyId, itemIdSql);
  return {
    rated: sql<number>`(case when ${r} <= 0 then 0 else ${qtyMilli} end)`,
    value: sql<number>`(case when ${r} <= 0 or ${v} <= 0 then 0 else max(0, cast(round(${v} * 1.0 * ${qtyMilli} / ${r}) as integer)) end)`,
  };
}

/**
 * EXISTS a live MRS of the GRN's item written after the GRN (in commit order: `rowid`, which D1 assigns
 * as batches land one at a time; `created_at` and `server_seq` are read before the batch, so they can
 * be out of commit order). Such an issue was valued with the GRN's money in the average, so the GRN's
 * cancel, or a change to its value, would leave that money behind. `grnSql` is the GRN row's alias;
 * `notIn` leaves out the GRN's own document group (an exchange's outgoing leg).
 */
export function storeOutSinceSql(companyId: string, grnSql: SQL, notIn?: SQL): SQL {
  return sql`exists (
    select 1 from ${storeTxn} os
    where os.company_id = ${companyId} and os.item_id = ${grnSql}.item_id and os.kind = 'mrs'
      and os.cancelled_at is null and os.rowid > ${grnSql}.rowid${notIn ? sql` and not (${notIn})` : sql``}
  )`;
}

/** The plain refusal when stock went out after a GRN (cancel, or setting its pending rate). */
export const ISSUED_SINCE_MESSAGE = "Stock from this delivery has already been issued. Record a return to the vendor instead.";

/**
 * CONTRACTS-W2 item 1, for MAINT's spares cost: the money a store entry took out of the store, in paise.
 * 0 for an entry that is not an issue (MRS), was cancelled, has no value (issued from stock that had no
 * rate) or belongs to another plant. `db` comes first, like every other lib helper.
 */
export async function storeIssueValuePaise(db: OrrnDb, companyId: string, storeTxnId: string): Promise<number> {
  const [row] = await db
    .select({ kind: storeTxn.kind, valuePaise: storeTxn.valuePaise, cancelledAt: storeTxn.cancelledAt })
    .from(storeTxn)
    .where(and(eq(storeTxn.id, storeTxnId), eq(storeTxn.companyId, companyId)))
    .limit(1);
  if (!row || row.kind !== "mrs" || row.cancelledAt !== null) return 0;
  return row.valuePaise;
}
