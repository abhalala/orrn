/**
 * Foundry helpers (spec P3, P15; digest Stages 3-5): default return streams, the locations a melt
 * posts to, the SQL that says how much of a lot is left, the close-out (tail) figures of a cast,
 * and the batch-abort statement melts use.
 *
 * Ledger shape of a melt (voucher_type `melt`, voucher_id = melt id, line = melt_input /
 * melt_output line):
 *   − scrap_grade `{scrapItemId}:{scrapGradeId}` at the lot's scrap store, per lot line
 *   − return_stream `{streamId}` at the plant-scrap location, per stream line
 *   + billet `{castId}` at the billet store (logs)
 *   + return_stream DROSS / FE / the chosen charge stream at plant scrap (by-products)
 * A lot's remaining kg = its own postings (OK, D/C deductions, cancel reversals) − Σ kg of live
 * melt lines on it. The ledger has no lot column; `melt_input.lot_id` carries the link.
 */
import { castTail, type CastTail } from "@orrn/domain";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";

import { melt, meltInput, returnStream, type ReturnStreamKind } from "@orrn/db/schema/foundry";
import { bundle } from "@orrn/db/schema/inventory";
import { dcNote, purchaseLot } from "@orrn/db/schema/purchase";
import { location, stockLedger, type LocationKind } from "@orrn/db/schema/stock";
import { company } from "@orrn/db/schema/tenant";

import { pushChunkedInserts, type OrrnDb, type SqliteBatchItem } from "./atomic";
import { nameKey } from "./purchase";
import { errorText } from "./store";

// ---------------------------------------------------------------------------
// Return streams
// ---------------------------------------------------------------------------

/**
 * The foundry sheet's nine internal streams (charged back into the furnace) and the two
 * by-products a melt throws off. Codes are stable: PL-9 posts press discard to DISCARD and
 * ends / QC rejects to PLANT-SCRAP; melts post dross to DROSS and iron to FE.
 */
export const DEFAULT_RETURN_STREAMS: readonly { code: string; name: string; kind: ReturnStreamKind }[] = [
  { code: "INGOT", name: "Ingot", kind: "charge" },
  { code: "PLANT-SCRAP", name: "Plant scrap", kind: "charge" },
  { code: "DISCARD", name: "Plant discard", kind: "charge" },
  { code: "DROSS-INGOT", name: "Dross ingot", kind: "charge" },
  { code: "BEND-LOG", name: "Bend log", kind: "charge" },
  { code: "HILL-METAL", name: "Hill metal", kind: "charge" },
  { code: "PIT-METAL", name: "Pit metal", kind: "charge" },
  { code: "TENDIS", name: "Tendis metal", kind: "charge" },
  { code: "DROSS-METAL", name: "Dross metal", kind: "charge" },
  { code: "DROSS", name: "Dross", kind: "byproduct" },
  { code: "FE", name: "Fe (iron)", kind: "byproduct" },
];

export const DROSS_STREAM = "DROSS";
export const FE_STREAM = "FE";

/** True when the company already has every default stream (by code or by name), so seeding would add nothing. */
export async function defaultReturnStreamsPresent(db: OrrnDb, companyId: string): Promise<boolean> {
  const rows = await db
    .select({ code: returnStream.code, nameKey: returnStream.nameKey })
    .from(returnStream)
    .where(eq(returnStream.companyId, companyId));
  const codes = new Set(rows.map((r) => r.code));
  const names = new Set(rows.map((r) => r.nameKey));
  return DEFAULT_RETURN_STREAMS.every((s) => codes.has(s.code) || names.has(nameKey(s.name)));
}

/** Insert the default streams a company is missing (by code or name); existing rows are untouched. */
export function defaultReturnStreamStatements(
  db: OrrnDb,
  companyId: string,
  opts: { userId: string | null; seq: number },
): SqliteBatchItem[] {
  const out: SqliteBatchItem[] = [];
  pushChunkedInserts(
    out,
    (rows) => db.insert(returnStream).values(rows).onConflictDoNothing(),
    DEFAULT_RETURN_STREAMS.map((s, idx) => ({
      id: crypto.randomUUID(),
      companyId,
      serverSeq: opts.seq,
      code: s.code,
      name: s.name,
      nameKey: nameKey(s.name),
      kind: s.kind,
      active: true,
      sortOrder: idx + 1,
      createdBy: opts.userId,
    })),
  );
  return out;
}

// ---------------------------------------------------------------------------
// Locations a melt posts to
// ---------------------------------------------------------------------------

export const NO_BILLET_STORE = "Add the billet store location first (Stock → Locations)";
export const NO_PLANT_SCRAP = "Add the plant scrap location first (Stock → Locations)";

async function resolveOne(
  db: OrrnDb,
  companyId: string,
  kind: LocationKind,
  preferredCode: string,
  missing: string,
  many: string,
): Promise<{ id: string; code: string }> {
  const rows = await db
    .select({ id: location.id, code: location.code })
    .from(location)
    .where(and(eq(location.companyId, companyId), eq(location.kind, kind), eq(location.active, true)))
    .orderBy(asc(location.sortOrder), asc(location.code))
    .limit(5);
  if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: missing });
  if (rows.length === 1) return rows[0]!;
  const coded = rows.find((r) => r.code === preferredCode);
  if (!coded) throw new TRPCError({ code: "BAD_REQUEST", message: many });
  return coded;
}

/** Where logs (billets) go: the only active billet store, else the one coded BILLET. */
export function resolveBilletStore(db: OrrnDb, companyId: string) {
  return resolveOne(db, companyId, "billet_store", "BILLET", NO_BILLET_STORE, "More than one billet store; retire the extra ones");
}

/** Where return streams sit: the only active plant-scrap (wip) location, else the one coded PLANT-SCRAP. */
export function resolvePlantScrap(db: OrrnDb, companyId: string) {
  return resolveOne(db, companyId, "wip", "PLANT-SCRAP", NO_PLANT_SCRAP, "More than one plant scrap location; retire the extra ones");
}

/** EXISTS: `locationId` is still an active location of `kind` (write-time guard). */
export function activeLocation(companyId: string, locationId: string, kind: LocationKind): SQL {
  return sql`exists (select 1 from ${location} al where al.id = ${locationId} and al.company_id = ${companyId} and al.kind = ${kind} and al.active = 1)`;
}

// ---------------------------------------------------------------------------
// Lot remaining kg
// ---------------------------------------------------------------------------

/** The outer purchase_lot's id, table-qualified (correlated subqueries must not bind to their own table). */
export const OUTER_LOT_ID: SQL = sql`${sql.identifier("purchase_lot")}.${sql.identifier("id")}`;

/**
 * What the lot put into scrap stock: its OK row, D/C deductions and cancel reversals (grams).
 * Two equality lookups on (company, voucher type, voucher id), the prefix of the voucher-line
 * unique index, so each lot reads only its own rows. These three voucher types post scrap_grade
 * rows only; an `item_kind` filter or an OR across them makes SQLite scan every scrap row of the
 * plant per lot instead (test "reads its own postings by voucher").
 */
export function lotPostedSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`(coalesce((
    select sum(lp.qty_g) from ${stockLedger} lp
    where lp.company_id = ${companyId} and lp.voucher_type in ('purchase_lot', 'purchase_lot_cancel') and lp.voucher_id = ${lotId}
  ), 0) + coalesce((
    select sum(lq.qty_g) from ${stockLedger} lq
    where lq.company_id = ${companyId} and lq.voucher_type = 'dc_note' and lq.voucher_id in (
      select dn.id from ${dcNote} dn where dn.company_id = ${companyId} and dn.lot_id = ${lotId}
    )
  ), 0))`;
}

/** What live (not cancelled) melts have drawn from the lot (grams). */
export function lotDrawnSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(di.kg_g) from ${meltInput} di
    join ${melt} dm on dm.id = di.melt_id and dm.company_id = di.company_id
    where di.company_id = ${companyId} and di.lot_id = ${lotId} and dm.cancelled_at is null
  ), 0)`;
}

/**
 * Bori (bag weight) of the lot's PENDING D/C note (grams; at most one note per lot is pending).
 * Bags are not metal: the foundry must not melt kg an open note is about to take off the lot, or
 * approving the note later drives the lot and its scrap grade below zero (PL-5 review r0 I-1).
 */
export function lotPendingBoriSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(pb.bori_deduction_g) from ${dcNote} pb
    where pb.company_id = ${companyId} and pb.lot_id = ${lotId} and pb.status = 'pending'
  ), 0)`;
}

/** What the lot holds for the furnace: its postings minus the bori of a pending note (grams). */
export function lotStockSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`(${lotPostedSql(companyId, lotId)} - ${lotPendingBoriSql(companyId, lotId)})`;
}

/**
 * A lot's remaining kg for melts and bori notes = postings − pending bori − live melt draws.
 * The one expression every read and write guard uses (lots.available, the melt check and its
 * INSERT … SELECT guard, dcNotes.create, the dc_note approval), so they can never disagree.
 * Approving a pending bori moves it from "pending" to "posted": the remaining kg does not change.
 */
export function lotRemainingSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`(${lotStockSql(companyId, lotId)} - ${lotDrawnSql(companyId, lotId)})`;
}

/**
 * Batch abort for a dc_note approval: fails the batch when the note carries bori, its lot is OK
 * and the lot's remaining kg is below zero AFTER the deduction posted. Unreachable through the
 * API (dcNotes.create and every melt hold the pending bori back); it guards rows that grew
 * outside those checks. `approval.decide` explains it with `explainApplyAbort` (lib/approvalApply.ts).
 */
export function dcNoteOverdrawAbort(db: OrrnDb, companyId: string, noteId: string): SqliteBatchItem {
  return foundryAbort(
    db,
    companyId,
    sql`exists (
      select 1 from ${dcNote} xn
      join ${purchaseLot} on ${purchaseLot.id} = xn.lot_id and ${purchaseLot.companyId} = xn.company_id
      where xn.id = ${noteId} and xn.company_id = ${companyId} and xn.bori_deduction_g > 0
        and ${purchaseLot.status} = 'ok' and ${lotRemainingSql(companyId, OUTER_LOT_ID)} < 0
    )`,
  );
}

/** The message for a bori the foundry already melted (dcNotes.create and the dc_note approval). */
export function boriMeltedMessage(lotNumber: string, drawnG: number, leftG: number, then = "Raise the note"): string {
  return `The foundry has already melted ${fmtKg(drawnG)} kg of ${lotNumber}; only ${fmtKg(Math.max(leftG, 0))} kg is left for a bori deduction. ${then} without bori (or with less)`;
}

/** Remaining and drawn kg of one lot (company-scoped; zeros for an unknown id). */
export async function lotRemaining(db: OrrnDb, companyId: string, lotId: string): Promise<{ remainingG: number; drawnG: number }> {
  const [row] = await db
    .select({ remainingG: lotRemainingSql(companyId, OUTER_LOT_ID), drawnG: lotDrawnSql(companyId, OUTER_LOT_ID) })
    .from(purchaseLot)
    .where(and(eq(purchaseLot.id, lotId), eq(purchaseLot.companyId, companyId)))
    .limit(1);
  return { remainingG: Number(row?.remainingG ?? 0), drawnG: Number(row?.drawnG ?? 0) };
}

/** NOT EXISTS: no live melt draws on the lot (an OK lot can then be cancelled). */
export function lotHasNoLiveDraws(companyId: string, lotId: SQL): SQL {
  return sql`not exists (
    select 1 from ${meltInput} ni
    join ${melt} nm on nm.id = ni.melt_id and nm.company_id = ni.company_id
    where ni.company_id = ${companyId} and ni.lot_id = ${lotId} and nm.cancelled_at is null
  )`;
}

// ---------------------------------------------------------------------------
// Cast close-out figures
// ---------------------------------------------------------------------------

/** The outer cast's id, table-qualified. `cast` is an SQL keyword, so it is always quoted. */
export const OUTER_CAST_ID: SQL = sql`${sql.identifier("cast")}.${sql.identifier("id")}`;

function liveMeltSum(companyId: string, castId: SQL, expr: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(${expr}) from ${melt} lm
    where lm.company_id = ${companyId} and lm.cast_id = ${castId} and lm.cancelled_at is null
  ), 0)`;
}

export function castInputSql(companyId: string, castId: SQL) {
  return liveMeltSum(companyId, castId, sql`lm.input_g`);
}
export function castLogsSql(companyId: string, castId: SQL) {
  return liveMeltSum(companyId, castId, sql`lm.logs_g`);
}
export function castByproductSql(companyId: string, castId: SQL) {
  return liveMeltSum(companyId, castId, sql`lm.dross_g + lm.fe_g + lm.returns_g`);
}
export function castAllowedBurnSql(companyId: string, castId: SQL) {
  return liveMeltSum(companyId, castId, sql`lm.allowed_burn_g`);
}
export function castLossSql(companyId: string, castId: SQL) {
  return liveMeltSum(companyId, castId, sql`lm.loss_g`);
}
export function castLiveMeltsSql(companyId: string, castId: SQL): SQL<number> {
  return sql<number>`(select count(*) from ${melt} cm where cm.company_id = ${companyId} and cm.cast_id = ${castId} and cm.cancelled_at is null)`;
}

/** Billets of the cast still in stock, any location (ledger). */
export function castBilletsOnHandSql(companyId: string, castId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(bl.qty_g) from ${stockLedger} bl
    where bl.company_id = ${companyId} and bl.item_kind = 'billet' and bl.item_ref = ${castId}
  ), 0)`;
}

/**
 * D22: billets the press weighed and logged beyond what the store held (Σ `press_run.billet_short_g`
 * of the cast's logged runs). Above 0 the cast shows "billets short by N kg" for the close-out.
 */
export function castBilletsShortSql(companyId: string, castId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(sr.billet_short_g) from press_run sr
    where sr.company_id = ${companyId} and sr.cast_id = ${castId} and sr.status = 'logged'
  ), 0)`;
}

/** Bundles packed from the cast that still count (void bundles never existed; RP11). */
export function castBundlesSql(companyId: string, castId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(bb.weight_g) from ${bundle} bb
    where bb.company_id = ${companyId} and bb.cast_id = ${castId} and bb.status <> 'void'
  ), 0)`;
}

/**
 * Discard, ends and rejects the press and QC returned for the cast. PL-9 (press runs, QC) extends
 * this with its own vouchers; until then nothing is attributed to a cast after the furnace.
 */
export function castPressReturnsSql(_companyId: string, _castId: SQL): SQL<number> {
  return sql<number>`0`;
}

/** Input − everything that explains it, as one SQL expression (for write-time guards). */
export function castTailSql(companyId: string, castId: SQL): SQL<number> {
  return sql<number>`(${castInputSql(companyId, castId)} - ${castByproductSql(companyId, castId)} - ${castAllowedBurnSql(
    companyId,
    castId,
  )} - ${castBundlesSql(companyId, castId)} - ${castPressReturnsSql(companyId, castId)} - ${castBilletsOnHandSql(companyId, castId)})`;
}

/** Write-time guard: the cast's tail is still within 1 % of its input (`|tail| × 10000 ≤ input × 100`). */
export function castTailWithinBand(companyId: string, castId: SQL, bandBp: number): SQL {
  return sql`abs(${castTailSql(companyId, castId)}) * 10000 <= ${castInputSql(companyId, castId)} * ${bandBp}`;
}

export type CastCloseout = CastTail & {
  inputG: number;
  logsG: number;
  byproductG: number;
  allowedBurnG: number;
  /** Σ melt loss beyond the 3 % burn allowance (negative when melts put out more than went in). */
  excessBurnG: number;
  bundlesG: number;
  pressReturnsG: number;
  billetsOnHandG: number;
  /** D22: billets logged by the press beyond what the store held (0 when none). */
  billetsShortG: number;
};

/** Live close-out figures of one cast (scoped to the company; zeros for an unknown id). */
export async function castCloseout(db: OrrnDb, companyId: string, castId: string): Promise<CastCloseout> {
  const id = sql`${castId}`;
  const [row] = await db
    .select({
      inputG: castInputSql(companyId, id),
      logsG: castLogsSql(companyId, id),
      byproductG: castByproductSql(companyId, id),
      allowedBurnG: castAllowedBurnSql(companyId, id),
      lossG: castLossSql(companyId, id),
      bundlesG: castBundlesSql(companyId, id),
      pressReturnsG: castPressReturnsSql(companyId, id),
      billetsOnHandG: castBilletsOnHandSql(companyId, id),
      billetsShortG: castBilletsShortSql(companyId, id),
    })
    .from(company)
    .where(eq(company.id, companyId))
    .limit(1);
  const n = (v: unknown) => Number(v ?? 0);
  const parts = {
    inputG: n(row?.inputG),
    logsG: n(row?.logsG),
    byproductG: n(row?.byproductG),
    allowedBurnG: n(row?.allowedBurnG),
    bundlesG: n(row?.bundlesG),
    pressReturnsG: n(row?.pressReturnsG),
    billetsOnHandG: n(row?.billetsOnHandG),
  };
  return { ...parts, billetsShortG: n(row?.billetsShortG), excessBurnG: n(row?.lossG) - parts.allowedBurnG, ...castTail(parts) };
}

// ---------------------------------------------------------------------------
// Batch abort
// ---------------------------------------------------------------------------

/**
 * One statement that fails the whole batch (NOT NULL violation on `melt_input.id`) when `failWhen`
 * is true at write time. A guarded INSERT … SELECT that matched nothing is otherwise a silent
 * no-op, so a melt whose cast was closed, or whose lot ran out, after the request read it would
 * land half. D1 rolls a failed batch back. Catch with `isFoundryAbort`.
 */
export function foundryAbort(db: OrrnDb, companyId: string, failWhen: SQL): SqliteBatchItem {
  return db.insert(meltInput).select(
    db
      .select({
        id: sql<string | null>`null`.as("id"),
        companyId: sql<string>`${company.id}`.as("company_id"),
        serverSeq: sql<number>`0`.as("server_seq"),
        meltId: sql<string>`'abort'`.as("melt_id"),
        line: sql<number>`0`.as("line"),
        kind: sql<"lot">`'lot'`.as("kind"),
        lotId: sql<string | null>`null`.as("lot_id"),
        returnStreamId: sql<string | null>`null`.as("return_stream_id"),
        itemRef: sql<string>`'abort'`.as("item_ref"),
        locationId: sql<string>`'abort'`.as("location_id"),
        kgG: sql<number>`0`.as("kg_g"),
        createdBy: sql<string | null>`null`.as("created_by"),
        createdAt: sql<number>`0`.as("created_at"),
      })
      .from(company)
      .where(and(eq(company.id, companyId), failWhen)),
  );
}

export function isFoundryAbort(e: unknown): boolean {
  return /NOT NULL constraint failed: melt_input\.id/.test(errorText(e));
}

/** A UNIQUE violation on the given index columns (e.g. a clientRequestId race). */
export function isUniqueViolation(e: unknown, columns: string): boolean {
  return errorText(e).includes(`UNIQUE constraint failed: ${columns}`);
}

/** Grams as kg for messages: 5000000 → "5,000". */
export function fmtKg(g: number): string {
  return (g / 1000).toLocaleString("en-IN", { maximumFractionDigits: 3 });
}
