/**
 * Foundry depth (XE parity lane FOUNDRY): where billets sit and the ledger rows that move them.
 *
 * Logs and billets are ONE ledger item, `billet` with item_ref = cast id; the location says which:
 * `billet_store` = logs (and full-length billets on a plant that does not cut), `billet_rack` = billets
 * cut to length, `press_floor` = billets issued to one press (`location.press_line_id`).
 *
 * Where a press run's billets come off at close (`pressDraws`, fix round 1): the run's press floor when
 * the plant has an active floor for that line (floor reality wins: a short floor goes negative and the
 * close says so, a count corrects it). With no floor, the cast's billets on the racks first (a plant that
 * cuts presses cut billets), then the billet store for the rest (uncut logs). A plant with no rack stock
 * of the cast draws everything from the billet store exactly as before.
 */
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";

import { billetCut, billetIssue, homogBatch, homogLine } from "@orrn/db/schema/foundryDepth";
import { location, stockLedger, type LedgerVoucherType, type LocationKind } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import { atomicBatch, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { foundryAbort } from "./foundry";
import { openReplay, readReplay, type Replay, type ReplayKind } from "./requestReplay";

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

export type PressDraw = { locationId: string; code: string; kind: BilletPlaceKind; qtyG: number };

/**
 * Where a press run's `kgG` of one cast comes off at close (#50, fix round 1). With an active floor for
 * the line: all of it from the floor, whatever the floor holds. Without: from the active racks that hold
 * the cast (sort order), up to what each holds, then the rest from the billet store. `store` may be null
 * on a read (preview) of a plant with no billet store; the rest is then left out.
 */
export async function pressDraws(
  db: OrrnDb,
  companyId: string,
  o: { pressLineId: string | null; store: { id: string; code: string } | null; castId: string; kgG: number },
): Promise<{ floor: { id: string; code: string } | null; draws: PressDraw[] }> {
  const floor = o.pressLineId ? await pressFloorFor(db, companyId, o.pressLineId) : null;
  if (floor) return { floor, draws: [{ locationId: floor.id, code: floor.code, kind: "press_floor", qtyG: o.kgG }] };
  const draws: PressDraw[] = [];
  let left = o.kgG;
  const racks = (await billetPlaces(db, companyId, { activeOnly: true })).filter((p) => p.kind === "billet_rack");
  for (const r of racks) {
    if (left <= 0) break;
    const have = await castAt(db, companyId, o.castId, r.id);
    const take = Math.min(left, have);
    if (take <= 0) continue;
    draws.push({ locationId: r.id, code: r.code, kind: "billet_rack", qtyG: take });
    left -= take;
  }
  if (left > 0 && o.store) draws.push({ locationId: o.store.id, code: o.store.code, kind: "billet_store", qtyG: left });
  return { floor: null, draws };
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

/**
 * Where a locked melt put its logs (its `melt` billet row's location, the billet store), with what the
 * cast holds there now. A cancel or correction reverses that row at that place, so it must still hold
 * the melt's logs: after cuts or issues the cast's total can cover a melt its store no longer does.
 */
export async function meltLogsPlace(db: OrrnDb, companyId: string, meltId: string, castId: string): Promise<{ id: string; code: string; haveG: number } | null> {
  const [row] = await db
    .select({ id: location.id, code: location.code })
    .from(stockLedger)
    .innerJoin(location, and(eq(location.id, stockLedger.locationId), eq(location.companyId, stockLedger.companyId)))
    .where(and(eq(stockLedger.companyId, companyId), eq(stockLedger.voucherType, "melt"), eq(stockLedger.voucherId, meltId), eq(stockLedger.itemKind, "billet")))
    .limit(1);
  if (!row) return null;
  return { ...row, haveG: await castAt(db, companyId, castId, row.id) };
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

// ---------------------------------------------------------------------------
// Homogenizing gate (#41): one allowance that every way logs leave the billet store uses
// ---------------------------------------------------------------------------

/** Pieces and kg of the cast that came out of RELEASED homogenizing batches. */
export function homogReleasedSql(companyId: string, castId: string, what: "pcs" | "kg"): SQL<number> {
  const col = what === "pcs" ? sql`hl.pcs` : sql`hl.kg_g`;
  return sql<number>`coalesce((
    select sum(${col}) from ${homogLine} hl join ${homogBatch} hb on hb.id = hl.batch_id and hb.company_id = hl.company_id
    where hl.company_id = ${companyId} and hl.cast_id = ${castId} and hb.status = 'released'
  ), 0)`;
}

/** Log pieces of the cast that left the billet store as logs: cut on the saw or shear, or issued whole to a press floor. */
export function homogPcsUsedSql(companyId: string, castId: string): SQL<number> {
  return sql<number>`(coalesce((
    select sum(bc.log_pcs) from ${billetCut} bc where bc.company_id = ${companyId} and bc.cast_id = ${castId}
  ), 0) + coalesce((
    select sum(bi.pcs) from ${billetIssue} bi join ${location} bl on bl.id = bi.from_location_id and bl.company_id = bi.company_id
    where bi.company_id = ${companyId} and bi.cast_id = ${castId} and bl.kind = 'billet_store'
  ), 0))`;
}

/**
 * Log kg of the cast that left the billet store as logs: cut, issued whole, or pressed straight from the
 * store by a press with no floor (its `press_run` rows there, net of reopens). A press close knows kg,
 * not pieces, so the press gate is in kg.
 */
export function homogKgUsedSql(companyId: string, castId: string): SQL<number> {
  return sql<number>`(coalesce((
    select sum(bc.log_g) from ${billetCut} bc where bc.company_id = ${companyId} and bc.cast_id = ${castId}
  ), 0) + coalesce((
    select sum(bi.kg_g) from ${billetIssue} bi join ${location} bl on bl.id = bi.from_location_id and bl.company_id = bi.company_id
    where bi.company_id = ${companyId} and bi.cast_id = ${castId} and bl.kind = 'billet_store'
  ), 0) + coalesce((
    select -sum(pl.qty_g) from ${stockLedger} pl join ${location} ll on ll.id = pl.location_id and ll.company_id = pl.company_id
    where pl.company_id = ${companyId} and pl.item_kind = 'billet' and pl.item_ref = ${castId}
      and pl.voucher_type in ('press_run', 'press_run_reopen') and ll.kind = 'billet_store'
  ), 0))`;
}

/** Read: the homogenized logs of a cast not yet used, in pieces and kg (may be negative after a setting change). */
export async function homogLeft(db: OrrnDb, companyId: string, castId: string): Promise<{ pcs: number; kgG: number }> {
  const [row] = await db
    .select({
      relPcs: homogReleasedSql(companyId, castId, "pcs"),
      relKg: homogReleasedSql(companyId, castId, "kg"),
      usedPcs: homogPcsUsedSql(companyId, castId),
      usedKg: homogKgUsedSql(companyId, castId),
    })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  const n = (v: unknown) => Number(v ?? 0);
  return { pcs: n(row?.relPcs) - n(row?.usedPcs), kgG: n(row?.relKg) - n(row?.usedKg) };
}

/** Write-time twin for a cut or an issue from the store: fails the batch when the pieces used went past the released pieces. */
export function homogPcsAbort(db: OrrnDb, companyId: string, castId: string): SqliteBatchItem {
  return foundryAbort(db, companyId, sql`${homogPcsUsedSql(companyId, castId)} > ${homogReleasedSql(companyId, castId, "pcs")}`);
}

/** The press close's write-time condition: the log kg used is still within the released kg. */
export function homogKgWithinSql(companyId: string, castId: string): SQL {
  return sql`${homogKgUsedSql(companyId, castId)} <= ${homogReleasedSql(companyId, castId, "kg")}`;
}

// ---------------------------------------------------------------------------
// Replay keys (AGENTS.md "Replay-safe floor writes"): the write's own audit row is the record
// ---------------------------------------------------------------------------

/** The replay record of a keyed foundry write, or null when the caller sent no key. */
export function openFloorReplay(db: OrrnDb, companyId: string, kind: ReplayKind, key: string | undefined, content: unknown): Promise<Replay | null> {
  return key ? openReplay(db, companyId, kind, key, content) : Promise.resolve(null);
}

/**
 * Runs a keyed write's batch. When it fails for any reason (a lost race on the audit row's key, or the
 * stock abort a duplicate trips because the first one took the kg), an identical request that landed
 * first answers instead; otherwise `onError` explains the failure.
 */
export async function keyedBatch<T extends Record<string, unknown>>(
  db: OrrnDb,
  companyId: string,
  replay: Replay | null,
  statements: SqliteBatchItem[],
  onError: (e: unknown) => never | Promise<never>,
): Promise<(T & { replayed: true }) | null> {
  try {
    await atomicBatch(db, statements);
    return null;
  } catch (e) {
    if (replay) {
      const again = await readReplay(db, companyId, replay);
      if (again.prior?.replay) return { ...(again.prior.replay as T), replayed: true };
    }
    await onError(e);
    throw e;
  }
}

/** A first answer stored on the replay record comes back marked `replayed`. */
export function priorAnswer<T>(replay: Replay | null): (T & { replayed: true }) | null {
  return replay?.prior?.replay ? { ...(replay.prior.replay as T), replayed: true } : null;
}
