/**
 * XE store (row 73): store valuation at the weighted average rate.
 *
 * Every `store_txn` row freezes the money it moved in `value_paise` (always >= 0, sign from `kind`):
 * a GRN is quantity x rate (0 with no rate), an MRS is valued at the item's average when it is written,
 * inside its own INSERT (`storeTxnInsert` uses `issueValueSql`), so the melt's and the nitriding log's
 * draws (`prepareStoreDraws`), MAINT's issues and the store screen's issues are all valued the same way
 * and a racing GRN cannot misvalue an issue. What an item holds is then a plain sum over its live
 * (not cancelled) entries, and a past month is the same sum as of a date. The formulas are the ones in
 * `@orrn/domain` (`grnValuePaise`, `issueValuePaise`); `store-xe.test.ts` runs both on the same examples.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";

import { storeTxn } from "@orrn/db/schema/store";

import type { OrrnDb } from "./atomic";

/** Held quantity of an item over its live entries (milli-units, every store location). */
export function storeHeldQtySql(companyId: string, itemIdSql: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(case when h.kind = 'grn' then h.qty_milli else -h.qty_milli end) from ${storeTxn} h
    where h.company_id = ${companyId} and h.item_id = ${itemIdSql} and h.cancelled_at is null
  ), 0)`;
}

/** Held value of an item over its live entries (paise; can dip below 0 after a late GRN cancel). */
export function storeHeldValueSql(companyId: string, itemIdSql: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(case when h.kind = 'grn' then h.value_paise else -h.value_paise end) from ${storeTxn} h
    where h.company_id = ${companyId} and h.item_id = ${itemIdSql} and h.cancelled_at is null
  ), 0)`;
}

/**
 * The value of an issue of `qtyMilli`, at the average of what the item holds when the statement runs
 * (`issueValuePaise` in SQL): 0 when nothing valued is held, everything left when the issue empties
 * the item, else round(value x qty / held) in floating point, never below 0.
 */
export function issueValueSql(companyId: string, itemIdSql: SQL, qtyMilli: number): SQL<number> {
  const q = storeHeldQtySql(companyId, itemIdSql);
  const v = storeHeldValueSql(companyId, itemIdSql);
  return sql<number>`(case
    when ${q} <= 0 or ${v} <= 0 then 0
    when ${qtyMilli} >= ${q} then ${v}
    else max(0, cast(round(${v} * 1.0 * ${qtyMilli} / ${q}) as integer))
  end)`;
}

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
