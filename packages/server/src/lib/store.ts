import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { location, stockLedger, type LedgerVoucherType } from "@orrn/db/schema/stock";
import {
  COUNTABLE_STORE_UNITS,
  storeItem,
  storeTxn,
  type StoreIssuePurpose,
  type StoreItemRow,
  type StoreTxnKind,
  type StoreTxnRow,
} from "@orrn/db/schema/store";
import { company } from "@orrn/db/schema/tenant";

import type { Context } from "../context";
import { allocateDocNumbers } from "./docNumber";
import { auditInsertGuarded } from "./audit";
import type { OrrnDb, SqliteBatchItem } from "./atomic";

const sqlUuid = sql<string>`lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', 1 + (random() & 3), 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6)))`;

/** 100,000 units (100 t of flux, 100,000 L): beyond any single delivery, far below 2^53 in sums. */
export const MAX_STORE_QTY_MILLI = 100_000_000;

/** Draws per cast batch: keeps the abort statement (one bound id per draw) under D1's 100 parameters. */
export const MAX_STORE_DRAWS = 40;

/** Milli-units as a plain decimal for messages: 12500 → "12.5". */
export function fmtMilli(milli: number): string {
  return (milli / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}

export function errorText(e: unknown): string {
  let text = "";
  for (let cur: unknown = e, depth = 0; cur && depth < 5; depth += 1) {
    text += ` ${cur instanceof Error ? cur.message : String(cur)}`;
    cur = (cur as { cause?: unknown }).cause;
  }
  return text;
}

// ---------------------------------------------------------------------------
// Shared resolvers and checks (routers and other documents' batches use the same ones)
// ---------------------------------------------------------------------------

export const NO_STORE_LOCATION = "Add the central store location first (Stock → Locations)";

/**
 * The central store location, for reads and writes alike: the only active `store` location, else
 * the one coded STORE. None → BAD_REQUEST (or null with `optional`); several without a STORE
 * code → BAD_REQUEST.
 */
export async function resolveStoreLocation(
  db: OrrnDb,
  companyId: string,
  opts: { optional: true },
): Promise<{ id: string; code: string } | null>;
export async function resolveStoreLocation(
  db: OrrnDb,
  companyId: string,
  opts?: { optional?: false },
): Promise<{ id: string; code: string }>;
export async function resolveStoreLocation(db: OrrnDb, companyId: string, opts: { optional?: boolean } = {}) {
  const rows = await db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(and(eq(location.companyId, companyId), eq(location.kind, "store"), eq(location.active, true)))
    .orderBy(asc(location.sortOrder), asc(location.code))
    .limit(5);
  if (rows.length === 0) {
    if (opts.optional) return null;
    throw new TRPCError({ code: "BAD_REQUEST", message: NO_STORE_LOCATION });
  }
  if (rows.length === 1) return rows[0]!;
  const coded = rows.find((r) => r.code === "STORE");
  if (!coded) throw new TRPCError({ code: "BAD_REQUEST", message: "More than one central store; retire the extra ones" });
  return coded;
}

export async function loadStoreItem(db: OrrnDb, companyId: string, id: string): Promise<StoreItemRow> {
  const [row] = await db
    .select()
    .from(storeItem)
    .where(and(eq(storeItem.id, id), eq(storeItem.companyId, companyId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Store item not found" });
  return row;
}

/** A live item whose quantities are valid for its unit (countable units take whole numbers). */
export function assertStoreQty(item: StoreItemRow, qtys: number[]): void {
  if (!item.active) throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is retired` });
  for (const q of qtys) {
    if (!Number.isInteger(q) || q < 1 || q > MAX_STORE_QTY_MILLI) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Quantity must be a positive number within the limit" });
    }
  }
  if ((COUNTABLE_STORE_UNITS as readonly string[]).includes(item.unit) && qtys.some((q) => q % 1000 !== 0)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is counted in whole numbers (${item.unit})` });
  }
}

export async function storeBalance(db: OrrnDb, companyId: string, itemId: string, locationId: string): Promise<number> {
  const [row] = await db
    .select({ b: storeBalanceSql(companyId, sql`${storeItem.id}`, locationId) })
    .from(storeItem)
    .where(and(eq(storeItem.companyId, companyId), eq(storeItem.id, itemId)))
    .limit(1);
  return Number(row?.b ?? 0);
}

export function storeShortError(item: Pick<StoreItemRow, "name" | "unit">, have: number) {
  return new TRPCError({
    code: "BAD_REQUEST",
    message: `Only ${fmtMilli(Math.max(have, 0))} ${item.unit} of ${item.name} in the store`,
  });
}

/** Read before the write: a draw the balance already cannot cover never takes a number. */
export async function requireStoreBalance(
  db: OrrnDb,
  companyId: string,
  item: StoreItemRow,
  locationId: string,
  needMilli: number,
) {
  const have = await storeBalance(db, companyId, item.id, locationId);
  if (have < needMilli) throw storeShortError(item, have);
}

/** Why a write did not land, from the state as it is now; null when nothing specific explains it. */
async function diagnoseStoreWrite(
  db: OrrnDb,
  companyId: string,
  itemId: string,
  needBalanceMilli: number | null,
  unit: string,
): Promise<TRPCError | null> {
  const item = await loadStoreItem(db, companyId, itemId);
  if (!item.active) return new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is retired` });
  if (item.unit !== unit) return new TRPCError({ code: "BAD_REQUEST", message: `${item.name} changed; open it again` });
  const loc = await resolveStoreLocation(db, companyId); // throws if the store was retired meanwhile
  if (needBalanceMilli !== null) {
    const have = await storeBalance(db, companyId, item.id, loc.id);
    if (have < needBalanceMilli) return storeShortError(item, have);
  }
  return null;
}

const STORE_CHANGED = () => new TRPCError({ code: "BAD_REQUEST", message: "The store changed; try again" });

/** The write did not land: say why from the state as it is now. */
export async function explainStoreWriteLost(
  db: OrrnDb,
  companyId: string,
  itemId: string,
  needBalanceMilli: number | null,
  unit: string,
): Promise<never> {
  throw (await diagnoseStoreWrite(db, companyId, itemId, needBalanceMilli, unit)) ?? STORE_CHANGED();
}

// ---------------------------------------------------------------------------
// Statement builders
// ---------------------------------------------------------------------------

/** The item's balance at `locationId`, as a scalar subquery over the ledger (milli-units). */
export function storeBalanceSql(companyId: string, itemIdSql: SQL, locationId: string | SQL): SQL {
  return sql`coalesce((
    select sum(l.qty_g) from ${stockLedger} l
    where l.company_id = ${companyId} and l.item_kind = 'store_item'
      and l.item_ref = ${itemIdSql} and l.location_id = ${typeof locationId === "string" ? sql`${locationId}` : locationId}
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
  /** The document whose batch drew this entry (RP17); omitted / null for store-screen entries. */
  source?: { type: string; id: string | null } | null;
  grnRef: string | null;
  exchangeId: string | null;
  note: string | null;
  clientRequestId?: string | null;
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
        sourceType: sql<string | null>`${input.source?.type ?? null}`.as("source_type"),
        sourceId: sql<string | null>`${input.source?.id ?? null}`.as("source_id"),
        grnRef: sql<string | null>`${input.grnRef}`.as("grn_ref"),
        exchangeId: sql<string | null>`${input.exchangeId}`.as("exchange_id"),
        note: sql<string | null>`${input.note}`.as("note"),
        clientRequestId: sql<string | null>`${input.clientRequestId ?? null}`.as("client_request_id"),
        cancelledAt: sql<number | null>`null`.as("cancelled_at"),
        cancelledBy: sql<string | null>`null`.as("cancelled_by"),
        cancelReason: sql<string | null>`null`.as("cancel_reason"),
        createdBy: sql<string | null>`${input.userId}`.as("created_by"),
        createdAt: sql<number>`${input.at.getTime()}`.as("created_at"),
        updatedAt: sql<number | null>`null`.as("updated_at"),
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
        createdAt: sql<number>`${input.at.getTime()}`.as("created_at"),
      })
      .from(storeTxn)
      .where(and(eq(storeTxn.companyId, input.companyId), eq(storeTxn.id, input.txnId))),
  );
}

// ---------------------------------------------------------------------------
// Cancel (RP15): reversal rows, both legs of an exchange together
// ---------------------------------------------------------------------------

/** WHERE: the target entry, plus the other leg when it belongs to an exchange. */
function cancelGroupWhere(txnId: string, exchangeId: string | null): SQL {
  return exchangeId
    ? (sql`(${storeTxn.id} = ${txnId} or ${storeTxn.exchangeId} = ${exchangeId})` as SQL)
    : (sql`${storeTxn.id} = ${txnId}` as SQL);
}

export type StoreCancelInput = {
  companyId: string;
  seq: number;
  txnId: string;
  /** The entry's exchange id, if any (read by the caller; it never changes). */
  exchangeId: string | null;
  userId: string | null;
  at: Date;
  reason: string;
};

/**
 * Reversal ledger rows for the entry (and its exchange partner): − of a GRN, + of an MRS, each
 * pointing at its original row (`reversal_of`), voucher type `store_grn_cancel` / `store_mrs_cancel`,
 * the entry's own id as voucher. Lands only for entries not cancelled yet, only while the item is
 * live and the entry's location is still an active `store` location (a retired item or location
 * holds nothing, so a cancel must not put stock back onto one: reactivate it first), and only if the
 * net effect of undoing the whole group leaves the balance at 0 or more (write time, same guard
 * shape as an issue). Run BEFORE `storeCancelMark`: the mark keys on these rows. When nothing
 * landed, `diagnoseStoreCancel` says why.
 *
 * It does not look at `source_type`: a document that drew stock (a melt) reverses its own draws
 * with it. `store.cancel` is what refuses entries that belong to another document.
 */
export function storeCancelRows(db: OrrnDb, input: StoreCancelInput): SqliteBatchItem {
  const { companyId } = input;
  const orig = alias(stockLedger, "orig");
  const o = (col: string) => sql`${sql.identifier("orig")}.${sql.identifier(col)}`;
  const groupNet = sql`coalesce((
    select sum(case when g.kind = 'grn' then g.qty_milli else -g.qty_milli end) from ${storeTxn} g
    where g.company_id = ${companyId} and g.cancelled_at is null
      and (g.id = ${input.txnId}${input.exchangeId ? sql` or g.exchange_id = ${input.exchangeId}` : sql``})
  ), 0)`;
  return db.insert(stockLedger).select(
    db
      .select({
        id: sqlUuid.as("id"),
        companyId: sql<string>`${storeTxn.companyId}`.as("company_id"),
        serverSeq: sql<number>`${input.seq}`.as("server_seq"),
        voucherType: sql<LedgerVoucherType>`case when ${storeTxn.kind} = 'grn' then 'store_grn_cancel' else 'store_mrs_cancel' end`.as("voucher_type"),
        voucherId: sql<string>`${storeTxn.id}`.as("voucher_id"),
        line: sql<number>`1`.as("line"),
        itemKind: sql<"store_item">`'store_item'`.as("item_kind"),
        itemRef: sql<string>`${storeTxn.itemId}`.as("item_ref"),
        locationId: sql<string | null>`${o("location_id")}`.as("location_id"),
        qtyG: sql<number>`-${o("qty_g")}`.as("qty_g"),
        postedAt: sql<number>`max(${input.at.getTime()}, ${o("posted_at")} + 1)`.as("posted_at"),
        reversalOf: sql<string | null>`${o("id")}`.as("reversal_of"),
        reason: sql<string | null>`${input.reason}`.as("reason"),
        createdBy: sql<string | null>`${input.userId}`.as("created_by"),
        createdAt: sql<number>`${input.at.getTime()}`.as("created_at"),
      })
      .from(storeTxn)
      .innerJoin(
        orig,
        and(
          eq(orig.companyId, storeTxn.companyId),
          eq(orig.voucherId, storeTxn.id),
          inArray(orig.voucherType, ["store_grn", "store_mrs"]),
          eq(orig.line, 1),
        ),
      )
      .where(
        and(
          eq(storeTxn.companyId, companyId),
          isNull(storeTxn.cancelledAt),
          cancelGroupWhere(input.txnId, input.exchangeId),
          sql`exists (select 1 from ${storeItem} i where i.id = ${storeTxn.itemId} and i.company_id = ${companyId} and i.active = 1)`,
          sql`exists (select 1 from ${location} s where s.id = ${storeTxn.locationId} and s.company_id = ${companyId} and s.kind = 'store' and s.active = 1)`,
          // Undoing the group must not take the balance below 0: balance − (what the group added).
          sql`${storeBalanceSql(companyId, sql`${storeTxn.itemId}`, sql`${storeTxn.locationId}`)} - ${groupNet} >= 0`,
        ),
      ),
  );
}

/**
 * Mark the entry (and partner) cancelled: lands only where this request's reversal row exists, so
 * a cancel that lost a race or failed the balance guard marks nothing. The number is kept.
 */
export function storeCancelMark(db: OrrnDb, input: StoreCancelInput): SqliteBatchItem {
  return db
    .update(storeTxn)
    .set({
      cancelledAt: input.at,
      cancelledBy: input.userId,
      cancelReason: input.reason,
      serverSeq: input.seq,
      updatedAt: input.at,
    })
    .where(
      and(
        eq(storeTxn.companyId, input.companyId),
        isNull(storeTxn.cancelledAt),
        cancelGroupWhere(input.txnId, input.exchangeId),
        sql`exists (
          select 1 from ${stockLedger} r
          where r.company_id = ${input.companyId} and r.server_seq = ${input.seq}
            and r.voucher_id = ${storeTxn.id} and r.reversal_of is not null
            and r.voucher_type in ('store_grn_cancel', 'store_mrs_cancel')
        )`,
      ),
    );
}

/** What a draw's source document is called in a message ("a melt"); other kinds get a generic message. */
const SOURCE_NOUNS: Record<string, string> = { melt: "melt", nitriding: "nitriding log" };

/**
 * `store.cancel` cannot cancel an entry that another document drew inside its own batch (RP17):
 * the document still records the consumption. Refused with where to cancel it instead.
 */
export function storeSourceLockedError(txn: Pick<StoreTxnRow, "number" | "sourceType">): TRPCError {
  const noun = txn.sourceType ? SOURCE_NOUNS[txn.sourceType] : undefined;
  return new TRPCError({
    code: "BAD_REQUEST",
    message: noun
      ? `${txn.number} belongs to a ${noun}; cancel the ${noun} instead`
      : `${txn.number} belongs to another document (${txn.sourceType}); cancel it there`,
  });
}

/**
 * Why a cancel's reversal did not land, from the state as it is now; null when nothing specific
 * explains it (then "The store changed; try again"). In order: already cancelled; the stock it put
 * in was drawn since (a GRN, or an exchange whose new items were used); the item is retired; the
 * entry's store location is retired or no longer a store. A document that reverses its own draws
 * (a melt's cancel) uses it for each draw that did not land.
 */
export async function diagnoseStoreCancel(db: OrrnDb, companyId: string, txnId: string): Promise<TRPCError | null> {
  const [txn] = await db
    .select()
    .from(storeTxn)
    .where(and(eq(storeTxn.id, txnId), eq(storeTxn.companyId, companyId)))
    .limit(1);
  if (!txn) return new TRPCError({ code: "NOT_FOUND", message: "Store entry not found" });
  if (txn.cancelledAt) return new TRPCError({ code: "BAD_REQUEST", message: `${txn.number} was already cancelled` });
  const group = txn.exchangeId
    ? await db
        .select()
        .from(storeTxn)
        .where(and(eq(storeTxn.companyId, companyId), eq(storeTxn.exchangeId, txn.exchangeId)))
    : [txn];
  const item = await loadStoreItem(db, companyId, txn.itemId);
  const net = group.reduce((sum, g) => sum + (g.kind === "grn" ? g.qtyMilli : -g.qtyMilli), 0);
  const have = await storeBalance(db, companyId, txn.itemId, txn.locationId);
  if (have < net) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: `Cannot cancel ${txn.number}: ${fmtMilli(net)} ${item.unit} of ${item.name} would have to come out, but only ${fmtMilli(Math.max(have, 0))} is in the store`,
    });
  }
  if (!item.active) {
    return new TRPCError({ code: "BAD_REQUEST", message: `${item.name} is retired; reactivate it before cancelling ${txn.number}` });
  }
  const [loc] = await db
    .select({ code: location.code, kind: location.kind, active: location.active })
    .from(location)
    .where(and(eq(location.id, txn.locationId), eq(location.companyId, companyId)))
    .limit(1);
  if (!loc || !loc.active || loc.kind !== "store") {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: `Store location ${loc?.code ?? "?"} of ${txn.number} is retired or no longer a store; reactivate it before cancelling`,
    });
  }
  return null;
}

/** The cancel did not land: say why from the state as it is now. */
export async function explainStoreCancelLost(db: OrrnDb, companyId: string, txnId: string): Promise<never> {
  throw (await diagnoseStoreCancel(db, companyId, txnId)) ?? STORE_CHANGED();
}

// ---------------------------------------------------------------------------
// Draws for another document's batch (RP17: a cast's consumables)
// ---------------------------------------------------------------------------

export type StoreDrawInput = {
  itemId: string;
  qtyMilli: number;
  /** A cast draws with purpose `melt` and `refId` = the cast id. */
  purpose: Exclude<StoreIssuePurpose, "exchange">;
  /** ≤ 64 characters (the router's cap on `store.issue`). */
  refId?: string | null;
  /** ≤ 500 characters. */
  note?: string | null;
};

/**
 * The document whose batch draws the stock: kind (`melt`, `nitriding`; lower-case letters and `_`,
 * ≤ 32) and id (≤ 64). Stored on each draw, so `store.cancel` refuses it and points at the document.
 */
export type StoreDrawSource = { type: string; id: string };

const SOURCE_TYPE = /^[a-z][a-z_]{0,31}$/;
const DRAW_REF_MAX = 64;
const DRAW_NOTE_MAX = 500;

type AuditCtx = Pick<Context, "session" | "impersonation"> & { db: OrrnDb; companyId: string };

/**
 * One statement that fails the whole batch (NOT NULL violation on `store_txn.id`) unless every
 * listed document landed. D1 rolls a failed batch back, so a document that includes the draws
 * (a cast) cannot land without its consumables. A refused draw is otherwise a silent no-op:
 * INSERT … SELECT inserts 0 rows. Put it AFTER the draws; catch with `isStoreDrawAbort`.
 */
export function storeDrawAbort(db: OrrnDb, companyId: string, ids: string[]): SqliteBatchItem {
  return db.insert(storeTxn).select(
    db
      .select({
        id: sql<string | null>`null`.as("id"),
        companyId: sql<string>`${company.id}`.as("company_id"),
        serverSeq: sql<number>`0`.as("server_seq"),
        kind: sql<StoreTxnKind>`'mrs'`.as("kind"),
        number: sql<string>`'abort'`.as("number"),
        period: sql<string>`'abort'`.as("period"),
        itemId: sql<string>`'abort'`.as("item_id"),
        qtyMilli: sql<number>`0`.as("qty_milli"),
        locationId: sql<string>`'abort'`.as("location_id"),
        purpose: sql<StoreIssuePurpose | null>`null`.as("purpose"),
        refId: sql<string | null>`null`.as("ref_id"),
        sourceType: sql<string | null>`null`.as("source_type"),
        sourceId: sql<string | null>`null`.as("source_id"),
        grnRef: sql<string | null>`null`.as("grn_ref"),
        exchangeId: sql<string | null>`null`.as("exchange_id"),
        note: sql<string | null>`null`.as("note"),
        clientRequestId: sql<string | null>`null`.as("client_request_id"),
        cancelledAt: sql<number | null>`null`.as("cancelled_at"),
        cancelledBy: sql<string | null>`null`.as("cancelled_by"),
        cancelReason: sql<string | null>`null`.as("cancel_reason"),
        createdBy: sql<string | null>`null`.as("created_by"),
        createdAt: sql<number>`0`.as("created_at"),
        updatedAt: sql<number | null>`null`.as("updated_at"),
      })
      .from(company)
      .where(
        and(
          eq(company.id, companyId),
          sql`(select count(*) from ${storeTxn} d where d.company_id = ${companyId} and d.id in (${sql.join(
            ids.map((id) => sql`${id}`),
            sql`, `,
          )})) < ${ids.length}`,
        ),
      ),
  );
}

export function isStoreDrawAbort(e: unknown): boolean {
  return /NOT NULL constraint failed: store_txn\.id/.test(errorText(e));
}

export type PreparedStoreDraws = {
  ids: string[];
  numbers: string[];
  /** Include all of these in the document's `atomicBatch`, in order (the abort statement is last). */
  statements: SqliteBatchItem[];
  /** After `isStoreDrawAbort(e)`: throws the BAD_REQUEST that says why (short balance, retired item, …). */
  explain: () => Promise<never>;
};

/**
 * Validate and build MRS draws (one MRS number each) for a document that consumes store items.
 * Validation (1 to 40 draws, item in this company and live, whole numbers for countable units,
 * text caps, store location, balance across all draws of an item) throws before any number is
 * taken. The statements keep the order txn₁, ledger₁, audit₁, txn₂, …, so draws of one item see
 * each other; each document INSERT holds the write-time balance guard; the trailing abort statement
 * fails the whole batch if any draw did not land.
 *
 * Every draw is marked with its document (`source`; when omitted, the draw's purpose and refId), so
 * `store.cancel` refuses it and the document's own cancel reverses it (`storeCancelRows` +
 * `storeCancelMark`). No draws at all is a caller bug (RangeError): skip the call instead.
 */
export async function prepareStoreDraws(
  db: OrrnDb,
  args: {
    companyId: string;
    userId: string | null;
    seq: number;
    at: Date;
    audit: AuditCtx;
    draws: StoreDrawInput[];
    /** The document drawing the stock, e.g. `{ type: "melt", id: meltId }`. */
    source?: StoreDrawSource;
  },
): Promise<PreparedStoreDraws> {
  const { companyId, draws, source } = args;
  if (draws.length === 0) throw new RangeError("No store draws");
  if (draws.length > MAX_STORE_DRAWS) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `At most ${MAX_STORE_DRAWS} store items per document` });
  }
  const tooLong = (s: string | null | undefined, max: number) => s != null && s.length > max;
  if (source && (!SOURCE_TYPE.test(source.type) || source.id.length < 1 || source.id.length > DRAW_REF_MAX)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "The drawing document needs a kind and an id (at most 64 characters)" });
  }
  if (draws.some((d) => tooLong(d.refId, DRAW_REF_MAX) || tooLong(d.note, DRAW_NOTE_MAX))) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `A store draw's reference is at most ${DRAW_REF_MAX} characters and its note ${DRAW_NOTE_MAX}` });
  }
  const items = new Map<string, StoreItemRow>();
  for (const d of draws) {
    if (!items.has(d.itemId)) items.set(d.itemId, await loadStoreItem(db, companyId, d.itemId));
    assertStoreQty(items.get(d.itemId)!, [d.qtyMilli]);
  }
  const store = await resolveStoreLocation(db, companyId);
  const need = new Map<string, number>();
  for (const d of draws) need.set(d.itemId, (need.get(d.itemId) ?? 0) + d.qtyMilli);
  for (const [itemId, qty] of need) await requireStoreBalance(db, companyId, items.get(itemId)!, store.id, qty);

  const block = await allocateDocNumbers(db, companyId, "mrs", args.at, draws.length, args.userId);
  const ids = draws.map(() => crypto.randomUUID());
  const statements: SqliteBatchItem[] = [];
  draws.forEach((d, i) => {
    const item = items.get(d.itemId)!;
    statements.push(
      storeTxnInsert(db, {
        id: ids[i]!, companyId, seq: args.seq, kind: "mrs", number: block.numbers[i]!, period: block.period,
        itemId: item.id, unit: item.unit, qtyMilli: d.qtyMilli, locationId: store.id,
        purpose: d.purpose, refId: d.refId ?? null, grnRef: null, exchangeId: null, note: d.note ?? null,
        source: source ?? { type: d.purpose, id: d.refId ?? null },
        userId: args.userId, at: args.at, guardBalance: true,
      }),
      storeLedgerInsert(db, { companyId, seq: args.seq, txnId: ids[i]!, userId: args.userId, at: args.at }),
      auditInsertGuarded(
        args.audit,
        {
          action: "store.issue",
          subjectType: "store_txn",
          subjectId: ids[i]!,
          meta: {
            number: block.numbers[i]!, itemId: item.id, qtyMilli: d.qtyMilli, purpose: d.purpose, refId: d.refId ?? null,
            source: source ?? null,
          },
        },
        { from: storeTxn, where: and(eq(storeTxn.id, ids[i]!), eq(storeTxn.companyId, companyId)) },
      ),
    );
  });
  statements.push(storeDrawAbort(db, companyId, ids));

  const explain = async (): Promise<never> => {
    for (const [itemId, qty] of need) {
      const why = await diagnoseStoreWrite(db, companyId, itemId, qty, items.get(itemId)!.unit);
      if (why) throw why;
    }
    throw STORE_CHANGED();
  };
  return { ids, numbers: block.numbers, statements, explain };
}
