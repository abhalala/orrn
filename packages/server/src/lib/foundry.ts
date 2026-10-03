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
import { dcNote } from "@orrn/db/schema/purchase";
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

/** What the lot put into scrap stock: its OK row, D/C deductions and cancel reversals (grams). */
export function lotPostedSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(lp.qty_g) from ${stockLedger} lp
    where lp.company_id = ${companyId} and lp.item_kind = 'scrap_grade' and (
      (lp.voucher_type in ('purchase_lot', 'purchase_lot_cancel') and lp.voucher_id = ${lotId})
      or (lp.voucher_type = 'dc_note' and lp.voucher_id in (
        select dn.id from ${dcNote} dn where dn.company_id = ${companyId} and dn.lot_id = ${lotId}
      ))
    )
  ), 0)`;
}

/** What live (not cancelled) melts have drawn from the lot (grams). */
export function lotDrawnSql(companyId: string, lotId: SQL): SQL<number> {
  return sql<number>`coalesce((
    select sum(di.kg_g) from ${meltInput} di
    join ${melt} dm on dm.id = di.melt_id and dm.company_id = di.company_id
    where di.company_id = ${companyId} and di.lot_id = ${lotId} and dm.cancelled_at is null
  ), 0)`;
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
  return { ...parts, excessBurnG: n(row?.lossG) - parts.allowedBurnG, ...castTail(parts) };
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
