/**
 * Central-store postings (spec P17, digest Stage 18). A GRN or MRS is one `store_txn` row plus one
 * `stock_ledger` row (item_kind `store_item`, at the STORE location, qty in milli-units) plus an
 * audit row, all in the caller's single `atomicBatch`.
 *
 * Never-negative rule: the document INSERT is `INSERT … SELECT … FROM store_item WHERE …` and an
 * issue's WHERE contains the balance check (`sum(stock_ledger) >= qty`) evaluated at write time.
 * D1 runs a batch serially with nothing interleaved, so two issues that would together overdraw
 * cannot both land: the second one's SELECT sees the first one's ledger row and inserts nothing.
 * The ledger row and the audit row are `INSERT … SELECT … FROM store_txn WHERE id = ?`, so they
 * land exactly when the document did. The caller reads `store_txn` back to see whether it landed.
 */
import { and, eq, sql, type SQL } from "drizzle-orm";

import { location, stockLedger, type LedgerVoucherType } from "@orrn/db/schema/stock";
import { storeItem, storeTxn, type StoreIssuePurpose, type StoreTxnKind } from "@orrn/db/schema/store";

import type { OrrnDb, SqliteBatchItem } from "./atomic";

const sqlUuid = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** 100,000 units (100 t of flux, 100,000 L): beyond any single delivery, far below 2^53 in sums. */
export const MAX_STORE_QTY_MILLI = 100_000_000;

/** Milli-units as a plain decimal for messages: 12500 → "12.5". */
export function fmtMilli(milli: number): string {
  return (milli / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

/** The item's balance at `locationId`, as a scalar subquery over the ledger (milli-units). */
export function storeBalanceSql(companyId: string, itemIdSql: SQL, locationId: string): SQL {
  return sql`coalesce((
    select sum(l.qty_g) from ${stockLedger} l
    where l.company_id = ${companyId} and l.item_kind = 'store_item'
      and l.item_ref = ${itemIdSql} and l.location_id = ${locationId}
  ), 0)`;
}

export type StoreTxnInput = {
  id: string;
  companyId: string;
  seq: number;
  kind: StoreTxnKind;
  number: string;
  period: string;
  itemId: string;
  /** The unit the caller validated the quantity against; the write fails if it changed since. */
  unit: string;
  qtyMilli: number;
  locationId: string;
  purpose: StoreIssuePurpose | null;
  refId: string | null;
  grnRef: string | null;
  exchangeId: string | null;
  note: string | null;
  userId: string | null;
  at: Date;
  /** Issues (and the outgoing leg of an exchange): the item must hold at least `qtyMilli`. */
  guardBalance: boolean;
  /** Extra write-time condition (the incoming leg of an exchange needs its outgoing leg). */
  and?: SQL;
};

/**
 * The document row. Lands only if the item is still active with the validated unit, the store
 * location is still an active `store` location of this company, and (issues) the balance still
 * covers the quantity.
 */
export function storeTxnInsert(db: OrrnDb, input: StoreTxnInput): SqliteBatchItem {
  const { companyId } = input;
  return db.insert(storeTxn).select(
    db
      .select({
        id: sql<string>`${input.id}`.as("id"),
        companyId: sql<string>`${storeItem.companyId}`.as("company_id"),
        serverSeq: sql<number>`${input.seq}`.as("server_seq"),
        kind: sql<StoreTxnKind>`${input.kind}`.as("kind"),
        number: sql<string>`${input.number}`.as("number"),
        period: sql<string>`${input.period}`.as("period"),
        itemId: sql<string>`${storeItem.id}`.as("item_id"),
        qtyMilli: sql<number>`${input.qtyMilli}`.as("qty_milli"),
        locationId: sql<string>`${input.locationId}`.as("location_id"),
        purpose: sql<StoreIssuePurpose | null>`${input.purpose}`.as("purpose"),
        refId: sql<string | null>`${input.refId}`.as("ref_id"),
        grnRef: sql<string | null>`${input.grnRef}`.as("grn_ref"),
        exchangeId: sql<string | null>`${input.exchangeId}`.as("exchange_id"),
        note: sql<string | null>`${input.note}`.as("note"),
        createdBy: sql<string | null>`${input.userId}`.as("created_by"),
        createdAt: sql<number>`${input.at.getTime()}`.as("created_at"),
      })
      .from(storeItem)
      .where(
        and(
          eq(storeItem.companyId, companyId),
          eq(storeItem.id, input.itemId),
          eq(storeItem.active, true),
          eq(storeItem.unit, input.unit as never),
          sql`exists (select 1 from ${location} s where s.id = ${input.locationId} and s.company_id = ${companyId} and s.kind = 'store' and s.active = 1)`,
          input.guardBalance
            ? sql`${storeBalanceSql(companyId, sql`${storeItem.id}`, input.locationId)} >= ${input.qtyMilli}`
            : undefined,
          input.and,
        ),
      ),
  );
}

/**
 * The ledger row of a document: + for a GRN (`store_grn`), − for an MRS (`store_mrs`), voucher =
 * the `store_txn` id, line 1. Run AFTER the document INSERT; it selects that row, so a document
 * that did not land posts nothing.
 */
export function storeLedgerInsert(
  db: OrrnDb,
  input: { companyId: string; seq: number; txnId: string; userId: string | null; at: Date },
): SqliteBatchItem {
  const isGrn = sql`${storeTxn.kind} = 'grn'`;
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${storeTxn.companyId}`.as("company_id"),
        serverSeq: sql<number>`${input.seq}`.as("server_seq"),
        voucherType: sql<LedgerVoucherType>`case when ${isGrn} then 'store_grn' else 'store_mrs' end`.as("voucher_type"),
        voucherId: sql<string>`${storeTxn.id}`.as("voucher_id"),
        line: sql<number>`1`.as("line"),
        itemKind: sql<"store_item">`'store_item'`.as("item_kind"),
        itemRef: sql<string>`${storeTxn.itemId}`.as("item_ref"),
        locationId: sql<string | null>`${storeTxn.locationId}`.as("location_id"),
        qtyG: sql<number>`case when ${isGrn} then ${storeTxn.qtyMilli} else -${storeTxn.qtyMilli} end`.as("qty_g"),
        postedAt: sql<number>`${input.at.getTime()}`.as("posted_at"),
        reversalOf: sql<string | null>`null`.as("reversal_of"),
        reason: sql<string | null>`${storeTxn.number}`.as("reason"),
        createdBy: sql<string | null>`${input.userId}`.as("created_by"),
        createdAt: sql<number>`${Date.now()}`.as("created_at"),
      })
      .from(storeTxn)
      .where(and(eq(storeTxn.companyId, input.companyId), eq(storeTxn.id, input.txnId))),
  );
}
