/**
 * Foundry depth (XE parity lane FOUNDRY): where billets sit and the ledger rows that move them.
 *
 * Logs and billets are ONE ledger item, `billet` with item_ref = cast id; the location says which:
 * `billet_store` = logs (and full-length billets on a plant that does not cut), `billet_rack` = billets
 * cut to length, `press_floor` = billets issued to one press (`location.press_line_id`). A press run
 * draws from its press's floor when the plant has an active floor for that line, else from the billet
 * store (`pressDrawLocation`), so a plant that never sets up floors sees no change.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { location, stockLedger, type LedgerVoucherType, type LocationKind } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import type { OrrnDb, SqliteBatchItem } from "./atomic";
import { foundryAbort } from "./foundry";

/** Locations that hold billets (logs or cut billets) of a cast. */
export const BILLET_PLACE_KINDS = ["billet_store", "billet_rack", "press_floor"] as const satisfies readonly LocationKind[];
export type BilletPlaceKind = (typeof BILLET_PLACE_KINDS)[number];

export type BilletPlace = { id: string; code: string; name: string; kind: BilletPlaceKind; pressLineId: string | null; active: boolean };

/** Every billet-holding location of the plant (active first, then by sort order). */
export async function billetPlaces(db: OrrnDb, companyId: string, opts: { activeOnly?: boolean } = {}): Promise<BilletPlace[]> {
  const rows = await db
    .select({ id: location.id, code: location.code, name: location.name, kind: location.kind, pressLineId: location.pressLineId, active: location.active })
    .from(location)
    .where(and(eq(location.companyId, companyId), inArray(location.kind, [...BILLET_PLACE_KINDS]), opts.activeOnly ? eq(location.active, true) : undefined))
    .orderBy(asc(location.sortOrder), asc(location.code))
    .limit(200);
  return rows.map((r) => ({ ...r, kind: r.kind as BilletPlaceKind }));
}

/** The one billet place of `kind` the request named, active, in this plant; else a refusal. */
export async function billetPlace(db: OrrnDb, companyId: string, locationId: string, kinds: readonly BilletPlaceKind[]): Promise<BilletPlace> {
  const [row] = await db
    .select({ id: location.id, code: location.code, name: location.name, kind: location.kind, pressLineId: location.pressLineId, active: location.active })
    .from(location)
    .where(and(eq(location.companyId, companyId), eq(location.id, locationId)))
    .limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Location not found" });
  if (!(kinds as readonly string[]).includes(row.kind)) throw new TRPCError({ code: "BAD_REQUEST", message: `${row.code} does not hold ${kinds.includes("billet_store") && kinds.length === 1 ? "logs" : "billets"}` });
  if (!row.active) throw new TRPCError({ code: "BAD_REQUEST", message: `${row.code} is retired` });
  return { ...row, kind: row.kind as BilletPlaceKind };
}

/** The active press floor of a press line, or null when the plant keeps no floor stock for it. */
export async function pressFloorFor(db: OrrnDb, companyId: string, pressLineId: string): Promise<{ id: string; code: string } | null> {
  const [row] = await db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(and(eq(location.companyId, companyId), eq(location.kind, "press_floor"), eq(location.pressLineId, pressLineId), eq(location.active, true)))
    .orderBy(asc(location.sortOrder), asc(location.code))
    .limit(1);
  return row ?? null;
}

/**
 * Where a press run's billets are debited at close (#50): the run's press floor when the plant has an
 * active one for that line, else the billet store as before.
 */
export async function pressDrawLocation(db: OrrnDb, companyId: string, pressLineId: string | null, billetStoreId: string): Promise<string> {
  if (!pressLineId) return billetStoreId;
  return (await pressFloorFor(db, companyId, pressLineId))?.id ?? billetStoreId;
}

/** A cast's billets at one location (grams, ledger). */
export function castAtSql(companyId: string, castId: string, locationId: string): SQL<number> {
  return sql<number>`coalesce((
    select sum(ca.qty_g) from ${stockLedger} ca
    where ca.company_id = ${companyId} and ca.item_kind = 'billet' and ca.item_ref = ${castId} and ca.location_id = ${locationId}
  ), 0)`;
}

/** Read: a cast's billets at one location (grams). */
export async function castAt(db: OrrnDb, companyId: string, castId: string, locationId: string): Promise<number> {
  const [row] = await db.select({ g: castAtSql(companyId, castId, locationId) }).from(company).where(eq(company.id, companyId)).limit(1);
  return Number(row?.g ?? 0);
}

/** Write-time twin: fails the batch when the cast's billets at the location went below zero after this write. */
export function castAtAbort(db: OrrnDb, companyId: string, castId: string, locationId: string): SqliteBatchItem {
  return foundryAbort(db, companyId, sql`${castAtSql(companyId, castId, locationId)} < 0`);
}

/** EXISTS: the location is still active and of one of `kinds` (write-time guard). */
export function activePlaceSql(companyId: string, locationId: string, kinds: readonly string[]): SQL {
  return sql`exists (select 1 from ${location} ap where ap.id = ${locationId} and ap.company_id = ${companyId} and ap.active = 1 and ap.kind in (${sql.join(
    kinds.map((k) => sql`${k}`),
    sql`, `,
  )}))`;
}

export type LedgerLine = { itemKind: "billet" | "return_stream"; itemRef: string; locationId: string; qtyG: number; reason: string };

/** Plain ledger rows of one foundry voucher (lines 1..n). The caller guards the batch with aborts. */
export function voucherRows(
  db: OrrnDb,
  o: { companyId: string; voucherType: LedgerVoucherType; voucherId: string; seq: number; at: Date; userId: string; lines: readonly LedgerLine[] },
): SqliteBatchItem[] {
  return o.lines
    .filter((l) => l.qtyG !== 0)
    .map((l, i) =>
      db.insert(stockLedger).values({
        id: crypto.randomUUID(),
        companyId: o.companyId,
        serverSeq: o.seq,
        voucherType: o.voucherType,
        voucherId: o.voucherId,
        line: i + 1,
        itemKind: l.itemKind,
        itemRef: l.itemRef,
        locationId: l.locationId,
        qtyG: l.qtyG,
        postedAt: o.at,
        reversalOf: null,
        reason: l.reason,
        createdBy: o.userId,
        createdAt: o.at,
      }),
    );
}
