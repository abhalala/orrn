/**
 * XE parity lane COST: the reads behind `costing.*` (routers/costing.ts). Every query is scoped by the
 * caller's company, aggregates with GROUP BY and binds no id list (run sets are expressed as a SQL
 * filter on `press_run r`, never as ids). The maths is `@orrn/domain` costing.
 *
 * Rules kept here, not in the router:
 * - Only logged PRODUCTION runs (plan purpose production, or no plan) are costed, as the press report.
 * - Metal per billet kg is the cast's own cost (Σ bought lot kg × lot rate ÷ billets produced; return
 *   streams enter at no cost, so press scrap is never credited a second time). A run's billets can
 *   come from several casts (`press_billet_use`); it takes their kg-weighted cost. A run with no cast
 *   cost takes the price master's metal rate on its day × the plant's bought share ÷ melt yield.
 * - Press minutes are start to stop (the tapped times when typed), and only when the times are trusted.
 */
import { TRPCError } from "@trpc/server";
import { eq, sql, type SQL } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";
import {
  chargeCostPaise,
  costingOn,
  kgPerHour,
  masterBilletPaise,
  monthOf,
  ratesOn,
  readCostingSettings,
  readFloorSettings,
  readPricingSettings,
  resolveRate,
  runCost,
  weightedPerKg,
  type CostingSettings,
  type MetalInput,
  type PriceRateRow,
  type RunCost,
} from "@orrn/domain";

import type { OrrnDb } from "./atomic";
import { MODULE_OFF_MESSAGE } from "./moduleGate";
import { can, type CompanyRole } from "./permissions";
import { companyToday } from "./purchase";

export const DAY_MS = 86_400_000;
/** Most runs one costing read takes; past it the answer says `truncated`. */
export const MAX_COST_RUNS = 5000;

// ---------------------------------------------------------------------------
// Company, gate, rate visibility
// ---------------------------------------------------------------------------

export async function costingCompany(db: OrrnDb, companyId: string, at: Date) {
  const row = await db.select({ settings: company.settings, modules: company.modules }).from(company).where(eq(company.id, companyId)).get();
  const settings = (row?.settings ?? {}) as Record<string, unknown>;
  const modules = Array.isArray(row?.modules) ? (row.modules as string[]) : [];
  return {
    settings,
    modules,
    on: costingOn(modules),
    costing: readCostingSettings(settings.costing),
    pricing: readPricingSettings(settings.pricing),
    priceOnSalesOrder: readFloorSettings(settings).priceOnSalesOrder,
    today: companyToday(settings, at),
  };
}
export type CostingCompany = Awaited<ReturnType<typeof costingCompany>>;

/**
 * `costing` is opt-in (`OPT_IN_MODULES`): FORBIDDEN unless the plant's module list names it. The
 * router-level gate covers mutations only, so every costing procedure (reads too) calls this.
 */
export function assertCostingOn(co: Pick<CostingCompany, "on">): void {
  if (!co.on) throw new TRPCError({ code: "FORBIDDEN", message: MODULE_OFF_MESSAGE });
}

/** Rates and margins: `order.price` AND the plant shows rates on orders (the C23 rule, as `analytics.orders`). */
export function ratesAllowed(role: CompanyRole | null | undefined, co: Pick<CostingCompany, "priceOnSalesOrder">): boolean {
  return co.priceOnSalesOrder && can({ company: role ? { role } : null, isPlatformAdmin: false, platformRole: null } as never, "order.price");
}

// ---------------------------------------------------------------------------
// Which runs
// ---------------------------------------------------------------------------

/** WHERE over `press_run r` LEFT JOIN `press_plan pp`: logged production runs of the company. */
export function runFilter(companyId: string, opts: { from?: string; to?: string; sectionId?: string; orderId?: string }): SQL {
  const parts: SQL[] = [
    sql`r.company_id = ${companyId}`,
    sql`r.status = 'logged'`,
    sql`coalesce(pp.purpose, 'production') = 'production'`,
    sql`coalesce(r.good_g, 0) > 0`,
    sql`coalesce(r.input_g, 0) > 0`,
  ];
  if (opts.from) parts.push(sql`r.production_day >= ${opts.from}`);
  if (opts.to) parts.push(sql`r.production_day <= ${opts.to}`);
  if (opts.sectionId) parts.push(sql`r.section_id = ${opts.sectionId}`);
  if (opts.orderId) {
    parts.push(sql`r.id in (select prl.press_run_id from press_run_line prl join sales_order_line sol on sol.id = prl.sales_order_line_id and sol.company_id = prl.company_id
      where prl.company_id = ${companyId} and sol.sales_order_id = ${opts.orderId})`);
  }
  return sql.join(parts, sql` and `);
}

const PLAN_JOIN = sql`left join press_plan pp on pp.id = r.plan_id and pp.company_id = r.company_id`;
const RUN_FROM = sql`press_run r ${PLAN_JOIN}`;
/** Billet rows joined to their run (and its plan), for a run filter. */
const BILLET_FROM = sql`press_billet_use bu join press_run r on r.id = bu.press_run_id and r.company_id = bu.company_id ${PLAN_JOIN}`;

/** Trusted press minutes of `r`, or null. */
const MINUTES = sql`case when r.time_unconfirmed = 0 and coalesce(r.tapped_start_at, r.started_at) is not null and coalesce(r.tapped_stop_at, r.stopped_at) is not null
  and coalesce(r.tapped_stop_at, r.stopped_at) > coalesce(r.tapped_start_at, r.started_at)
  then (coalesce(r.tapped_stop_at, r.stopped_at) - coalesce(r.tapped_start_at, r.started_at)) / 60000.0 else null end`;

export type RunRow = {
  id: string;
  number: string;
  productionDay: string;
  sectionId: string;
  sectionCode: string;
  dieInstanceId: string | null;
  copyCode: string | null;
  pressLineId: string | null;
  castId: string | null;
  inputG: number;
  goodG: number;
  discardG: number;
  endsG: number;
  rejectG: number;
  minutes: number | null;
};

const RUN_ORDER = sql`order by r.production_day desc, r.number desc`;

/**
 * The runs a read actually takes: the first `limit` of the filter in screen order. The cast and
 * billet reads use this (a subquery, never an id list), so a wide date range never pulls billet
 * rows for runs past the page or past `MAX_COST_RUNS`.
 */
export function selectedRuns(where: SQL, limit: number): SQL {
  return sql`r.id in (select r.id from ${RUN_FROM} where ${where} ${RUN_ORDER} limit ${limit})`;
}

async function loadRuns(db: OrrnDb, where: SQL, limit = MAX_COST_RUNS): Promise<{ runs: RunRow[]; truncated: boolean }> {
  const rows = await db.all<Record<string, unknown>>(sql`
    select r.id, r.number, coalesce(r.production_day, '') as production_day, r.section_id, d.section_code, r.die_instance_id, di.code as copy_code,
      r.press_line_id, r.cast_id, coalesce(r.input_g, 0) as input_g, coalesce(r.good_g, 0) as good_g, coalesce(r.discard_g, 0) as discard_g,
      coalesce(r.ends_g, 0) as ends_g, coalesce(r.reject_g, 0) as reject_g, ${MINUTES} as minutes
    from ${RUN_FROM}
    join die d on d.id = r.section_id and d.company_id = r.company_id
    left join die_instance di on di.id = r.die_instance_id and di.company_id = r.company_id
    where ${where}
    ${RUN_ORDER}
    limit ${limit + 1}`);
  const truncated = rows.length > limit;
  return {
    truncated,
    runs: rows.slice(0, limit).map((r) => ({
      id: String(r.id),
      number: String(r.number),
      productionDay: String(r.production_day),
      sectionId: String(r.section_id),
      sectionCode: String(r.section_code),
      dieInstanceId: (r.die_instance_id as string | null) ?? null,
      copyCode: (r.copy_code as string | null) ?? null,
      pressLineId: (r.press_line_id as string | null) ?? null,
      castId: (r.cast_id as string | null) ?? null,
      inputG: Number(r.input_g),
      goodG: Number(r.good_g),
      discardG: Number(r.discard_g),
      endsG: Number(r.ends_g),
      rejectG: Number(r.reject_g),
      minutes: r.minutes == null ? null : Math.round(Number(r.minutes)),
    })),
  };
}

// ---------------------------------------------------------------------------
// Metal: cast cost per billet kg, billets per run, the master fallback
// ---------------------------------------------------------------------------

type CastCost = { castId: string; number: string | null; costPaise: number | null; producedG: number; perBilletKgPaise: number | null };

/** The casts the filtered runs drew billets from (billet rows, else the run's own cast). */
function castsOfRuns(where: SQL): SQL {
  return sql`select bu.cast_id from ${BILLET_FROM} where ${where}
    union select r.cast_id from ${RUN_FROM} where ${where} and r.cast_id is not null`;
}

async function castCosts(db: OrrnDb, companyId: string, where: SQL): Promise<Map<string, CastCost>> {
  const casts = castsOfRuns(where);
  const [lots, produced] = await Promise.all([
    db.all<{ cast_id: string; lot_id: string; rate_paise: number | null; kg_g: number }>(sql`
      select m.cast_id, mi.lot_id, pl.rate_paise, sum(mi.kg_g) as kg_g
      from melt_input mi
      join melt m on m.id = mi.melt_id and m.company_id = mi.company_id
      join purchase_lot pl on pl.id = mi.lot_id and pl.company_id = mi.company_id
      where mi.company_id = ${companyId} and mi.kind = 'lot' and m.status = 'locked' and m.cancelled_at is null and m.cast_id in (${casts})
      group by m.cast_id, mi.lot_id, pl.rate_paise`),
    db.all<{ cast_id: string; number: string | null; produced_g: number }>(sql`
      select c.id as cast_id, c.number, coalesce((select sum(m.logs_g) from melt m where m.company_id = c.company_id and m.cast_id = c.id and m.status = 'locked' and m.cancelled_at is null), 0) as produced_g
      from ${sql.identifier("cast")} c where c.company_id = ${companyId} and c.id in (${casts})`),
  ]);
  const byCast = new Map<string, { kgG: number; ratePaise: number | null }[]>();
  for (const l of lots) {
    const list = byCast.get(l.cast_id) ?? [];
    list.push({ kgG: Number(l.kg_g), ratePaise: l.rate_paise != null && Number(l.rate_paise) > 0 ? Number(l.rate_paise) : null });
    byCast.set(l.cast_id, list);
  }
  const out = new Map<string, CastCost>();
  for (const p of produced) {
    const lines = byCast.get(p.cast_id) ?? [];
    const costPaise = lines.length > 0 ? chargeCostPaise(lines) : null;
    const producedG = Number(p.produced_g);
    out.set(p.cast_id, {
      castId: p.cast_id,
      number: p.number,
      costPaise,
      producedG,
      perBilletKgPaise: costPaise != null && producedG > 0 ? Math.round((costPaise * 1000) / producedG) : null,
    });
  }
  return out;
}

async function billetUses(db: OrrnDb, where: SQL): Promise<Map<string, { castId: string; kgG: number }[]>> {
  const rows = await db.all<{ run_id: string; cast_id: string; kg_g: number }>(sql`
    select bu.press_run_id as run_id, bu.cast_id, sum(bu.kg_g) as kg_g
    from ${BILLET_FROM}
    where ${where} group by bu.press_run_id, bu.cast_id`);
  const out = new Map<string, { castId: string; kgG: number }[]>();
  for (const r of rows) {
    const list = out.get(r.run_id) ?? [];
    list.push({ castId: r.cast_id, kgG: Number(r.kg_g) });
    out.set(r.run_id, list);
  }
  return out;
}

export type FoundryFactors = { meltYieldBp: number | null; boughtShareBp: number | null; melts: number };

/** The plant's melt yield and bought share of the charge over the last year of locked melts. */
export async function foundryFactors(db: OrrnDb, companyId: string, at: Date): Promise<FoundryFactors> {
  const since = at.getTime() - 365 * DAY_MS;
  const [row] = await db.all<{ melts: number; input_g: number; logs_g: number; lot_g: number }>(sql`
    select count(*) as melts, coalesce(sum(m.input_g), 0) as input_g, coalesce(sum(m.logs_g), 0) as logs_g,
      coalesce(sum((select sum(mi.kg_g) from melt_input mi where mi.company_id = m.company_id and mi.melt_id = m.id and mi.kind = 'lot')), 0) as lot_g
    from melt m where m.company_id = ${companyId} and m.status = 'locked' and m.cancelled_at is null and coalesce(m.casting_end_at, m.created_at) >= ${since}`);
  const input = Number(row?.input_g ?? 0);
  const logs = Number(row?.logs_g ?? 0);
  const lot = Number(row?.lot_g ?? 0);
  return {
    melts: Number(row?.melts ?? 0),
    meltYieldBp: input > 0 && logs > 0 ? Math.round((logs * 10_000) / input) : null,
    boughtShareBp: input > 0 && logs > 0 ? Math.round((lot * 10_000) / input) : null,
  };
}

/** Active metal rows of the plant's metal list (a handful). */
async function metalRows(db: OrrnDb, companyId: string, source: string): Promise<PriceRateRow[]> {
  const rows = await db.all<{ id: string; key: string; paise: number; effective_from: string; created_at: number }>(sql`
    select id, key, paise, effective_from, created_at from price_rate
    where company_id = ${companyId} and kind = 'metal' and key = ${source} and status = 'active' order by effective_from`);
  return rows.map((r) => ({ id: r.id, kind: "metal", key: r.key, paise: Number(r.paise), effectiveFrom: r.effective_from, status: "active", createdAt: Number(r.created_at), detail: null }));
}

// ---------------------------------------------------------------------------
// Speeds and press per section
// ---------------------------------------------------------------------------

export type Speeds = {
  /** Section id -> kg per hour from its trusted runs. */
  section: Map<string, { kgPerHour: number; runs: number }>;
  plant: number | null;
  /** Section id -> the press line that ran it most. */
  line: Map<string, string>;
};

/** Press speed per section and the press each section runs on, from the last `days` of logged production runs. */
export async function sectionSpeeds(db: OrrnDb, companyId: string, at: Date, days = 180): Promise<Speeds> {
  const from = new Date(at.getTime() - days * DAY_MS).toISOString().slice(0, 10);
  const where = runFilter(companyId, { from });
  const [rows, lines] = await Promise.all([
    db.all<{ section_id: string; good_g: number; minutes: number; runs: number }>(sql`
      select r.section_id, sum(r.good_g) as good_g, sum(${MINUTES}) as minutes, count(*) as runs
      from ${RUN_FROM} where ${where} and ${MINUTES} is not null group by r.section_id`),
    db.all<{ section_id: string; press_line_id: string; runs: number }>(sql`
      select r.section_id, r.press_line_id, count(*) as runs from ${RUN_FROM}
      where ${where} and r.press_line_id is not null group by r.section_id, r.press_line_id order by r.section_id, runs desc, r.press_line_id`),
  ]);
  const section = new Map<string, { kgPerHour: number; runs: number }>();
  let g = 0;
  let min = 0;
  for (const r of rows) {
    const k = kgPerHour(Number(r.good_g), Number(r.minutes));
    if (k != null) section.set(r.section_id, { kgPerHour: k, runs: Number(r.runs) });
    g += Number(r.good_g);
    min += Number(r.minutes);
  }
  const line = new Map<string, string>();
  for (const l of lines) if (!line.has(l.section_id)) line.set(l.section_id, l.press_line_id);
  return { section, plant: kgPerHour(g, min), line };
}

// ---------------------------------------------------------------------------
// Costed runs
// ---------------------------------------------------------------------------

export type MetalSourceInfo = MetalInput & { casts: { castId: string; number: string | null; kgG: number; perBilletKgPaise: number | null }[]; rateDate: string | null };

export type CostedRun = RunRow & { metal: MetalSourceInfo; ratesFrom: string | null; cost: RunCost };

/** The plant-wide inputs every costing read shares: foundry factors, the metal list, press speeds. */
export type CostBasisInputs = { factors: FoundryFactors; metal: PriceRateRow[]; speeds: Speeds };

/** Load the shared inputs once; a read that costs two run sets passes them to both `costRuns` calls. */
export async function costBasisInputs(db: OrrnDb, companyId: string, co: CostingCompany, at: Date): Promise<CostBasisInputs> {
  const [factors, metal, speeds] = await Promise.all([foundryFactors(db, companyId, at), metalRows(db, companyId, co.pricing.metalSource), sectionSpeeds(db, companyId, at)]);
  return { factors, metal, speeds };
}

/** The selected runs with their casts and billet rows; the cast and billet reads cover only those runs. */
export async function loadRunInputs(db: OrrnDb, companyId: string, where: SQL, limit: number) {
  const chosen = sql`${where} and ${selectedRuns(where, limit)}`;
  const [loaded, casts, uses] = await Promise.all([loadRuns(db, where, limit), castCosts(db, companyId, chosen), billetUses(db, chosen)]);
  return { ...loaded, casts, uses };
}

/** Logged production runs the filter matches (at most `limit`, else `MAX_COST_RUNS`), costed. */
export async function costRuns(
  db: OrrnDb,
  companyId: string,
  co: CostingCompany,
  opts: { from?: string; to?: string; sectionId?: string; orderId?: string; limit?: number },
  at: Date,
  shared?: CostBasisInputs,
): Promise<{ runs: CostedRun[]; truncated: boolean; factors: FoundryFactors }> {
  const where = runFilter(companyId, opts);
  const [{ runs, truncated, casts, uses }, { factors, metal, speeds }] = await Promise.all([
    loadRunInputs(db, companyId, where, opts.limit ?? MAX_COST_RUNS),
    shared ?? costBasisInputs(db, companyId, co, at),
  ]);
  const costed = runs.map((r): CostedRun => {
    const parts = uses.get(r.id) ?? (r.castId ? [{ castId: r.castId, kgG: r.inputG }] : []);
    const castInfo = parts.map((p) => {
      const c = casts.get(p.castId);
      return { castId: p.castId, number: c?.number ?? null, kgG: p.kgG, perBilletKgPaise: c?.perBilletKgPaise ?? null };
    });
    let m: MetalSourceInfo;
    const known = castInfo.length > 0 && castInfo.every((c) => c.perBilletKgPaise != null);
    if (known) {
      m = { basis: "cast", paisePerBilletKg: weightedPerKg(castInfo.map((c) => ({ goodG: c.kgG, paisePerKg: c.perBilletKgPaise }))), casts: castInfo, rateDate: null };
    } else {
      // Limit (owner item): this assumes the billets came from the plant's own furnace. A run on
      // bought-in billets, or a legacy run with no cast, is costed at bought share × list ÷ yield.
      const rate = r.productionDay ? resolveRate(metal, "metal", co.pricing.metalSource, r.productionDay) : null;
      m = rate
        ? {
            basis: "master",
            paisePerBilletKg: masterBilletPaise(rate.paise, factors.meltYieldBp, factors.boughtShareBp),
            listPaisePerKg: rate.paise,
            meltYieldBp: factors.meltYieldBp,
            boughtShareBp: factors.boughtShareBp,
            casts: castInfo,
            rateDate: rate.effectiveFrom,
          }
        : { basis: "none", paisePerBilletKg: null, casts: castInfo, rateDate: null };
    }
    const version = ratesOn(co.costing.rates, r.productionDay);
    const cost = runCost({
      inputG: r.inputG,
      goodG: r.goodG,
      discardG: r.discardG,
      endsG: r.endsG,
      rejectG: r.rejectG,
      runMinutes: r.minutes,
      metal: m,
      rates: version,
      fallbackKgPerHour: speeds.section.get(r.sectionId)?.kgPerHour ?? speeds.plant,
    });
    return { ...r, metal: m, ratesFrom: version?.from ?? null, cost };
  });
  return { runs: costed, truncated, factors };
}

export type CostRollup = {
  runs: number;
  goodG: number;
  inputG: number;
  recoveryBp: number | null;
  metalPaisePerKg: number | null;
  stages: Record<string, number | null>;
  totalPaisePerKg: number | null;
  /** Good kg whose total cost is unknown (left out of the averages). */
  unknownG: number;
};

/** Good-weighted cost of a group of runs. */
export function rollup(runs: readonly CostedRun[]): CostRollup {
  const goodG = runs.reduce((s, r) => s + r.goodG, 0);
  const inputG = runs.reduce((s, r) => s + r.inputG, 0);
  const stages: Record<string, number | null> = {};
  for (const st of ["casting", "extrusion", "ageing", "finishing", "packing"]) {
    stages[st] = weightedPerKg(runs.map((r) => ({ goodG: r.goodG, paisePerKg: r.cost.stages.find((s) => s.stage === st)?.paisePerKg ?? null })));
  }
  return {
    runs: runs.length,
    goodG,
    inputG,
    recoveryBp: inputG > 0 ? Math.round((goodG * 10_000) / inputG) : null,
    metalPaisePerKg: weightedPerKg(runs.map((r) => ({ goodG: r.goodG, paisePerKg: r.cost.metalPaisePerKg }))),
    stages,
    totalPaisePerKg: weightedPerKg(runs.map((r) => ({ goodG: r.goodG, paisePerKg: r.cost.totalPaisePerKg }))),
    unknownG: runs.filter((r) => r.cost.totalPaisePerKg == null).reduce((s, r) => s + r.goodG, 0),
  };
}

/** Group costed runs by a key. */
export function groupRuns<K>(runs: readonly CostedRun[], key: (r: CostedRun) => K): Map<K, CostedRun[]> {
  const out = new Map<K, CostedRun[]>();
  for (const r of runs) {
    const k = key(r);
    const list = out.get(k);
    if (list) list.push(r);
    else out.set(k, [r]);
  }
  return out;
}

export const runMonth = (r: CostedRun) => monthOf(r.productionDay);

export type { CostingSettings };
