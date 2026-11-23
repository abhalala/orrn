/**
 * XE parity lane COST (rows 16, 17, 51, 52, 61, 92): cost per kg by stage, margin, press capacity,
 * a demand forecast and die maintenance due dates. Pure rules only; the server reads the plant's data
 * and calls these. Money is integer paise, weights integer grams, times integer minutes.
 *
 * Every figure carries its basis so a screen can say where it came from. Nothing here is a black box:
 * the forecast is a moving average (with a seasonal index when two years of orders exist), the die
 * prediction is the median interval of the copy's own history and a straight line through its weight
 * readings.
 */
import { addDaysYmd, roundDiv } from "./pricing";

// ---------------------------------------------------------------------------
// The module gate
// ---------------------------------------------------------------------------

/**
 * `costing` is opt-in (owner prod rule 2026-11-23): on only when the plant's module list names it.
 * An empty list (which turns every older module on) leaves it off.
 * TODO(xe-bill): switch callers to `isModuleOn(modules, "costing")` once BILL's `OPT_IN_MODULES` lands
 * on main with `costing` in it.
 */
export function costingOn(modules: readonly string[] | null | undefined): boolean {
  return Array.isArray(modules) && modules.some((m) => typeof m === "string" && m.trim().toLowerCase() === "costing");
}

// ---------------------------------------------------------------------------
// Settings (`company.settings.costing`)
// ---------------------------------------------------------------------------

export const COST_STAGES = ["casting", "extrusion", "ageing", "finishing", "packing"] as const;
export type CostStage = (typeof COST_STAGES)[number];
export const COST_RATE_BASES = ["kg", "hour"] as const;
export type CostRateBasis = (typeof COST_RATE_BASES)[number];

/**
 * One stage's conversion rate. `kg`: paise per kg (casting per kg of billets, the others per good kg).
 * `hour`: paise per hour. Extrusion uses the run's own press time; the other stages divide by
 * `kgPerHour`, the stage's typed throughput.
 */
export type StageRate = { basis: CostRateBasis; paise: number; kgPerHour: number | null };

/** Stage rates from a date on. The version with the latest `from` on or before a run's day applies. */
export type StageRateVersion = { from: string; stages: Partial<Record<CostStage, StageRate>> };

export type CostingSettings = {
  /** Effective-dated stage rates, oldest first. A change adds a version; past runs keep theirs. */
  rates: StageRateVersion[];
  /** A line whose margin is below this share of its rate is flagged (basis points; 800 = 8 %). */
  lowMarginBp: number;
  /** Press days in a week and hours in a press day, for capacity. */
  workDaysPerWeek: number;
  hoursPerDay: number;
  /** Planned stops per press per week (hours), plant-wide, and per press line id when typed. */
  downtimeHoursPerWeek: number;
  lineDowntimeHours: Record<string, number>;
  /** Press speed when a section has no history and neither does the plant (kg per hour). */
  defaultKgPerHour: number | null;
  /** Days from order date to due when an order has no expected date. */
  leadDays: number;
  /** Die fallbacks when a copy, its section and the plant have no history (kg between treatments). */
  nitrideEveryKg: number | null;
  correctEveryKg: number | null;
  /** A copy is "due soon" within this share of its interval (bp) or this many days. */
  dieSoonBp: number;
  dieSoonDays: number;
};

export const DEFAULT_COSTING_SETTINGS: CostingSettings = {
  rates: [],
  lowMarginBp: 800,
  workDaysPerWeek: 6,
  hoursPerDay: 22,
  downtimeHoursPerWeek: 0,
  lineDowntimeHours: {},
  defaultKgPerHour: null,
  leadDays: 21,
  nitrideEveryKg: null,
  correctEveryKg: null,
  dieSoonBp: 1500,
  dieSoonDays: 14,
};

export const MAX_COST_PAISE = 100_000_000;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

const intIn = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;

function readStageRate(raw: unknown): StageRate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.basis !== "kg" && r.basis !== "hour") return null;
  if (!intIn(r.paise, 0, MAX_COST_PAISE)) return null;
  const kph = intIn(r.kgPerHour, 1, 1_000_000) ? r.kgPerHour : null;
  return { basis: r.basis, paise: r.paise, kgPerHour: kph };
}

/** Read `company.settings.costing` with defaults; bad values fall back, never throw. */
export function readCostingSettings(raw: unknown): CostingSettings {
  const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const d = DEFAULT_COSTING_SETTINGS;
  const rates: StageRateVersion[] = [];
  if (Array.isArray(s.rates)) {
    for (const v of s.rates) {
      if (!v || typeof v !== "object") continue;
      const o = v as Record<string, unknown>;
      if (typeof o.from !== "string" || !YMD.test(o.from)) continue;
      const stages: Partial<Record<CostStage, StageRate>> = {};
      const src = o.stages && typeof o.stages === "object" ? (o.stages as Record<string, unknown>) : {};
      for (const st of COST_STAGES) {
        const r = readStageRate(src[st]);
        if (r) stages[st] = r;
      }
      rates.push({ from: o.from, stages });
    }
  }
  rates.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const lineDowntimeHours: Record<string, number> = {};
  if (s.lineDowntimeHours && typeof s.lineDowntimeHours === "object") {
    for (const [k, v] of Object.entries(s.lineDowntimeHours as Record<string, unknown>)) if (intIn(v, 0, 168)) lineDowntimeHours[k] = v;
  }
  return {
    rates,
    lowMarginBp: intIn(s.lowMarginBp, 0, 10_000) ? s.lowMarginBp : d.lowMarginBp,
    workDaysPerWeek: intIn(s.workDaysPerWeek, 1, 7) ? s.workDaysPerWeek : d.workDaysPerWeek,
    hoursPerDay: intIn(s.hoursPerDay, 1, 24) ? s.hoursPerDay : d.hoursPerDay,
    downtimeHoursPerWeek: intIn(s.downtimeHoursPerWeek, 0, 168) ? s.downtimeHoursPerWeek : d.downtimeHoursPerWeek,
    lineDowntimeHours,
    defaultKgPerHour: intIn(s.defaultKgPerHour, 1, 100_000) ? s.defaultKgPerHour : null,
    leadDays: intIn(s.leadDays, 0, 365) ? s.leadDays : d.leadDays,
    nitrideEveryKg: intIn(s.nitrideEveryKg, 1, 10_000_000) ? s.nitrideEveryKg : null,
    correctEveryKg: intIn(s.correctEveryKg, 1, 10_000_000) ? s.correctEveryKg : null,
    dieSoonBp: intIn(s.dieSoonBp, 0, 10_000) ? s.dieSoonBp : d.dieSoonBp,
    dieSoonDays: intIn(s.dieSoonDays, 0, 365) ? s.dieSoonDays : d.dieSoonDays,
  };
}

/** The rate version that applies on `day` (latest `from` on or before it), or null. */
export function ratesOn(versions: readonly StageRateVersion[], day: string): StageRateVersion | null {
  let hit: StageRateVersion | null = null;
  for (const v of versions) if (v.from <= day && (!hit || v.from >= hit.from)) hit = v;
  return hit;
}

/** Add or replace the version starting `from`; the list stays sorted. */
export function putRateVersion(versions: readonly StageRateVersion[], next: StageRateVersion): StageRateVersion[] {
  const out = versions.filter((v) => v.from !== next.from);
  out.push(next);
  return out.sort((a, b) => (a.from < b.from ? -1 : 1));
}

// ---------------------------------------------------------------------------
// Row 16: cost per kg of one press run
// ---------------------------------------------------------------------------

export type MetalBasis =
  /** The billets' own cast cost: Σ bought lot kg × lot rate ÷ billets produced (melt loss is inside). */
  | "cast"
  /** No cast cost: the price master's metal rate on the run day, × the plant's bought share of the charge ÷ its melt yield. */
  | "master"
  | "none";

export type MetalInput = {
  basis: MetalBasis;
  /** Metal cost per kg of billet, paise. Null when unknown. */
  paisePerBilletKg: number | null;
  /** For `master`: the list rate, the plant's melt yield and the bought share used (bp). */
  listPaisePerKg?: number | null;
  meltYieldBp?: number | null;
  boughtShareBp?: number | null;
};

/**
 * Metal per kg of billet from the price master when the cast has no cost. Press scrap goes back to
 * the furnace at no cost (the cast cost counts bought lots only, return streams at zero), so the same
 * rule is kept here: only the bought share of the charge is paid for, and melt loss raises the price
 * of what comes out. Without foundry data both factors are 100 %.
 */
export function masterBilletPaise(listPaisePerKg: number, meltYieldBp: number | null, boughtShareBp: number | null): number {
  const y = meltYieldBp != null && meltYieldBp > 0 ? Math.min(meltYieldBp, 10_000) : 10_000;
  const b = boughtShareBp != null && boughtShareBp >= 0 ? Math.min(boughtShareBp, 10_000) : 10_000;
  return roundDiv(listPaisePerKg * b, y);
}

export type RunCostInput = {
  inputG: number;
  goodG: number;
  discardG: number;
  endsG: number;
  rejectG: number;
  /** Press minutes (start to stop), null when the times are not trusted. */
  runMinutes: number | null;
  metal: MetalInput;
  rates: StageRateVersion | null;
  /** The section's own press speed, for an hour-based extrusion rate on a run without trusted times. */
  fallbackKgPerHour?: number | null;
};

export type StageLine = {
  stage: CostStage;
  paisePerKg: number | null;
  basis: CostRateBasis | null;
  ratePaise: number | null;
  /** Why the figure is null, or how it was worked out when it is not plain. */
  note: "not_set" | "no_time" | "no_throughput" | "run_time" | "section_speed" | null;
};

export type LossLine = { kind: "melt" | "butt" | "ends" | "rejects"; g: number | null; paisePerKg: number | null };

export type RunCost = {
  recoveryBp: number | null;
  /** Metal per good kg (billet metal × input ÷ good). */
  metalPaisePerKg: number | null;
  /** Of that, what the press losses cost (butt, ends, rejects), each per good kg. */
  losses: LossLine[];
  stages: StageLine[];
  /** Metal + every stage. Null when metal or any stage that has a rate is unknown. */
  totalPaisePerKg: number | null;
  /** Stages with no rate set: counted as zero and listed, never hidden. */
  missing: (CostStage | "metal")[];
};

/** Cost per good kg of one logged run. */
export function runCost(input: RunCostInput): RunCost {
  const { inputG, goodG } = input;
  const recoveryBp = inputG > 0 ? roundDiv(Math.max(0, goodG) * 10_000, inputG) : null;
  const missing: (CostStage | "metal")[] = [];
  const B = input.metal.paisePerBilletKg;
  let metalPaisePerKg: number | null = null;
  const losses: LossLine[] = [];
  if (B != null && goodG > 0 && inputG > 0) {
    metalPaisePerKg = roundDiv(B * inputG, goodG);
    const per = (g: number) => roundDiv(B * Math.max(0, g), goodG);
    losses.push({ kind: "butt", g: input.discardG, paisePerKg: per(input.discardG) });
    losses.push({ kind: "ends", g: input.endsG, paisePerKg: per(input.endsG) });
    losses.push({ kind: "rejects", g: input.rejectG, paisePerKg: per(input.rejectG) });
  } else {
    missing.push("metal");
  }
  if (input.metal.basis === "master" && input.metal.meltYieldBp != null && input.metal.listPaisePerKg != null) {
    // Melt loss is in the billet price already; shown so the screen can list it.
    const lossBp = 10_000 - Math.min(10_000, input.metal.meltYieldBp);
    losses.unshift({ kind: "melt", g: null, paisePerKg: input.metal.meltYieldBp > 0 ? roundDiv(input.metal.listPaisePerKg * lossBp, input.metal.meltYieldBp) : null });
  }

  const stages: StageLine[] = COST_STAGES.map((stage) => {
    const r = input.rates?.stages[stage];
    if (!r) {
      missing.push(stage);
      return { stage, paisePerKg: null, basis: null, ratePaise: null, note: "not_set" as const };
    }
    if (r.basis === "kg") {
      // Casting is paid per kg of billets: a good kg needs input ÷ good kg of billets.
      const v = stage === "casting" ? (goodG > 0 && inputG > 0 ? roundDiv(r.paise * inputG, goodG) : null) : r.paise;
      return { stage, paisePerKg: v, basis: "kg" as const, ratePaise: r.paise, note: null };
    }
    if (stage === "extrusion") {
      if (input.runMinutes != null && input.runMinutes > 0 && goodG > 0) {
        // paise/h × minutes ÷ 60 ÷ (good g ÷ 1000)
        return { stage, paisePerKg: roundDiv(r.paise * input.runMinutes * 1000, 60 * goodG), basis: "hour" as const, ratePaise: r.paise, note: "run_time" as const };
      }
      const kph = input.fallbackKgPerHour ?? r.kgPerHour;
      if (kph != null && kph > 0) return { stage, paisePerKg: roundDiv(r.paise, kph), basis: "hour" as const, ratePaise: r.paise, note: "section_speed" as const };
      return { stage, paisePerKg: null, basis: "hour" as const, ratePaise: r.paise, note: "no_time" as const };
    }
    if (r.kgPerHour != null && r.kgPerHour > 0) return { stage, paisePerKg: roundDiv(r.paise, r.kgPerHour), basis: "hour" as const, ratePaise: r.paise, note: null };
    return { stage, paisePerKg: null, basis: "hour" as const, ratePaise: r.paise, note: "no_throughput" as const };
  });

  const unknownStage = stages.some((s) => s.ratePaise != null && s.paisePerKg == null);
  const totalPaisePerKg =
    metalPaisePerKg == null || unknownStage ? null : metalPaisePerKg + stages.reduce((s, x) => s + (x.paisePerKg ?? 0), 0);
  return { recoveryBp, metalPaisePerKg, losses, stages, totalPaisePerKg, missing };
}

/** Good-weighted average of per-kg figures (nulls skipped); null when nothing is known. */
export function weightedPerKg(parts: readonly { goodG: number; paisePerKg: number | null }[]): number | null {
  let num = 0;
  let den = 0;
  for (const p of parts) {
    if (p.paisePerKg == null || !(p.goodG > 0)) continue;
    num += p.paisePerKg * p.goodG;
    den += p.goodG;
  }
  return den > 0 ? roundDiv(num, den) : null;
}

/** Rupee amount of `g` grams at `paisePerKg`, half up. */
export function amountPaise(g: number, paisePerKg: number): number {
  return roundDiv(g * paisePerKg, 1000);
}

// ---------------------------------------------------------------------------
// Row 17: margin
// ---------------------------------------------------------------------------

export type Margin = { marginPaisePerKg: number; marginBp: number; low: boolean };

/**
 * Rate minus cost, per kg, and as a share of the rate. Null when the rate or the cost is unknown:
 * an unknown cost is never "rate minus zero" and is never flagged.
 */
export function marginOf(ratePaise: number | null | undefined, costPaise: number | null | undefined, lowMarginBp: number): Margin | null {
  if (ratePaise == null || costPaise == null || !(ratePaise > 0)) return null;
  const m = ratePaise - costPaise;
  const bp = m >= 0 ? roundDiv(m * 10_000, ratePaise) : -roundDiv(-m * 10_000, ratePaise);
  return { marginPaisePerKg: m, marginBp: bp, low: bp < lowMarginBp };
}

export type CostBasis = "actual" | "section_month" | "section" | "plant_month" | "plant" | "none";

/** The cost a line or a report row uses: its own runs first, then the section, then the plant. */
export function pickCost(c: {
  actual?: number | null;
  sectionMonth?: number | null;
  section?: number | null;
  plantMonth?: number | null;
  plant?: number | null;
}): { paisePerKg: number | null; basis: CostBasis } {
  if (c.actual != null) return { paisePerKg: c.actual, basis: "actual" };
  if (c.sectionMonth != null) return { paisePerKg: c.sectionMonth, basis: "section_month" };
  if (c.section != null) return { paisePerKg: c.section, basis: "section" };
  if (c.plantMonth != null) return { paisePerKg: c.plantMonth, basis: "plant_month" };
  if (c.plant != null) return { paisePerKg: c.plant, basis: "plant" };
  return { paisePerKg: null, basis: "none" };
}

// ---------------------------------------------------------------------------
// Calendar helpers (company calendar days, `YYYY-MM-DD`)
// ---------------------------------------------------------------------------

function ymdToUtc(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!);
}
export function daysBetween(a: string, b: string): number {
  return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86_400_000);
}
/** The Monday on or before `ymd`. */
export function weekStart(ymd: string): string {
  const dow = new Date(ymdToUtc(ymd)).getUTCDay(); // 0 Sunday
  return addDaysYmd(ymd, -((dow + 6) % 7));
}
export function monthOf(ymd: string): string {
  return ymd.slice(0, 7);
}
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const t = y! * 12 + (m! - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
}
export function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number);
  const [yb, mb] = b.split("-").map(Number);
  return yb! * 12 + mb! - (ya! * 12 + ma!);
}

// ---------------------------------------------------------------------------
// Row 51: capacity
// ---------------------------------------------------------------------------

/** Kg per hour from good grams over minutes (integer kg/h, half up); null without both. */
export function kgPerHour(goodG: number, minutes: number): number | null {
  if (!(goodG > 0) || !(minutes > 0)) return null;
  return roundDiv(goodG * 60, minutes * 1000);
}

/** Press minutes a press has in one week. */
export function weekMinutes(s: Pick<CostingSettings, "workDaysPerWeek" | "hoursPerDay" | "downtimeHoursPerWeek" | "lineDowntimeHours">, lineId: string): number {
  const down = s.lineDowntimeHours[lineId] ?? s.downtimeHoursPerWeek;
  return Math.max(0, s.workDaysPerWeek * s.hoursPerDay * 60 - down * 60);
}

/** Minutes to press `g` at `kgPerHour`; null without a speed. */
export function minutesFor(g: number, kph: number | null): number | null {
  if (kph == null || !(kph > 0)) return null;
  return roundDiv(Math.max(0, g) * 60, kph * 1000);
}

export type LoadItem = {
  lineId: string;
  /** Week index from the current week (0); overdue work lands in week 0. */
  week: number;
  minutes: number;
  g: number;
  ref: string;
};

export type WeekLoad = { week: number; start: string; availableMin: number; bookedMin: number; loadBp: number | null; over: boolean; refs: { ref: string; minutes: number; g: number }[] };

/** Week-by-week load per press: booked minutes against available, the biggest causes first. */
export function weekLoads(opts: { firstWeek: string; weeks: number; lines: readonly { id: string; availableMin: number }[]; items: readonly LoadItem[]; topRefs?: number }): Map<string, WeekLoad[]> {
  const out = new Map<string, WeekLoad[]>();
  for (const l of opts.lines) {
    out.set(
      l.id,
      Array.from({ length: opts.weeks }, (_, w) => ({ week: w, start: addDaysYmd(opts.firstWeek, w * 7), availableMin: l.availableMin, bookedMin: 0, loadBp: null, over: false, refs: [] })),
    );
  }
  const refs = new Map<string, Map<string, { minutes: number; g: number }>>();
  for (const it of opts.items) {
    const weeks = out.get(it.lineId);
    if (!weeks || it.week < 0 || it.week >= opts.weeks) continue;
    weeks[it.week]!.bookedMin += it.minutes;
    const key = `${it.lineId}|${it.week}`;
    const m = refs.get(key) ?? new Map();
    const cur = m.get(it.ref) ?? { minutes: 0, g: 0 };
    m.set(it.ref, { minutes: cur.minutes + it.minutes, g: cur.g + it.g });
    refs.set(key, m);
  }
  for (const [lineId, weeks] of out) {
    for (const w of weeks) {
      w.loadBp = w.availableMin > 0 ? roundDiv(w.bookedMin * 10_000, w.availableMin) : null;
      w.over = w.bookedMin > w.availableMin;
      const m = refs.get(`${lineId}|${w.week}`);
      if (m) {
        w.refs = [...m.entries()]
          .map(([ref, v]) => ({ ref, ...v }))
          .sort((a, b) => b.minutes - a.minutes || (a.ref < b.ref ? -1 : 1))
          .slice(0, opts.topRefs ?? 8);
      }
    }
  }
  return out;
}

/** The week index (from `firstWeek`) a due day falls in; overdue days are week 0. */
export function weekIndex(firstWeek: string, day: string): number {
  return Math.max(0, Math.floor(daysBetween(firstWeek, day) / 7));
}

// ---------------------------------------------------------------------------
// Row 52: forecast
// ---------------------------------------------------------------------------

export type ForecastMethod = "ma3" | "ma3_seasonal" | "too_little";

export type ForecastResult = {
  method: ForecastMethod;
  /** Months of history the method saw (first month with an order to the last full month). */
  historyMonths: number;
  /** Average of the last three full months (grams per month). */
  baseG: number | null;
  /** Seasonal index per calendar month 01..12 (bp, 10000 = an average month); only for `ma3_seasonal`. */
  seasonBp: Record<string, number> | null;
  forecast: { month: string; g: number }[];
  /** What the method would have said for each of the last months, against what came. */
  backtest: { month: string; forecastG: number; actualG: number }[];
  /** Mean absolute error of the backtest as a share of actual (bp); null without a backtest. */
  errorBp: number | null;
};

export const SEASONAL_MIN_MONTHS = 24;

function seasonIndex(series: readonly { month: string; g: number }[]): Record<string, number> | null {
  const sums = new Map<string, { s: number; n: number }>();
  let total = 0;
  for (const p of series) {
    const mm = p.month.slice(5, 7);
    const cur = sums.get(mm) ?? { s: 0, n: 0 };
    sums.set(mm, { s: cur.s + p.g, n: cur.n + 1 });
    total += p.g;
  }
  if (total <= 0 || sums.size < 12) return null;
  const avg = total / series.length;
  const out: Record<string, number> = {};
  for (const [mm, v] of sums) out[mm] = Math.round(((v.s / v.n) / avg) * 10_000);
  return out;
}

function predict(series: readonly { month: string; g: number }[], target: string, seasonal: Record<string, number> | null): number | null {
  // The last three months before `target`.
  const idx = series.findIndex((p) => p.month === addMonths(target, -1));
  if (idx < 2) return null;
  const last = series.slice(idx - 2, idx + 1);
  if (!seasonal) return Math.round(last.reduce((s, p) => s + p.g, 0) / 3);
  // Take the season out of the three months, average, put the target month's season back.
  const de = last.map((p) => p.g / ((seasonal[p.month.slice(5, 7)] ?? 10_000) / 10_000));
  const base = de.reduce((s, v) => s + v, 0) / 3;
  return Math.round(base * ((seasonal[target.slice(5, 7)] ?? 10_000) / 10_000));
}

/**
 * Monthly demand forecast from order history. `history` holds grams per month (missing months are
 * zero); `currentMonth` is not counted (it is not over). Three full months are needed; with
 * SEASONAL_MIN_MONTHS of history a seasonal index per calendar month is applied.
 */
export function forecastMonths(history: readonly { month: string; g: number }[], currentMonth: string, horizon = 3, backtestMonths = 6): ForecastResult {
  const byMonth = new Map(history.map((h) => [h.month, h.g]));
  const months = [...byMonth.keys()].filter((m) => m < currentMonth && (byMonth.get(m) ?? 0) > 0).sort();
  const first = months[0];
  const lastFull = addMonths(currentMonth, -1);
  const series: { month: string; g: number }[] = [];
  if (first) for (let m = first; m <= lastFull; m = addMonths(m, 1)) series.push({ month: m, g: byMonth.get(m) ?? 0 });
  const n = series.length;
  if (n < 3) return { method: "too_little", historyMonths: n, baseG: null, seasonBp: null, forecast: [], backtest: [], errorBp: null };
  const seasonal = n >= SEASONAL_MIN_MONTHS ? seasonIndex(series) : null;
  const method: ForecastMethod = seasonal ? "ma3_seasonal" : "ma3";
  const baseG = Math.round(series.slice(-3).reduce((s, p) => s + p.g, 0) / 3);

  // Forward: each month is predicted from the three before it, using predictions once past the data.
  const ext = [...series];
  const forecast: { month: string; g: number }[] = [];
  for (let i = 0; i < horizon; i++) {
    const target = addMonths(currentMonth, i);
    const g = Math.max(0, predict(ext, target, seasonal) ?? 0);
    forecast.push({ month: target, g });
    ext.push({ month: target, g });
  }

  const backtest: { month: string; forecastG: number; actualG: number }[] = [];
  for (let i = Math.max(3, n - backtestMonths); i < n; i++) {
    const target = series[i]!.month;
    const f = predict(series, target, seasonal);
    if (f != null) backtest.push({ month: target, forecastG: Math.max(0, f), actualG: series[i]!.g });
  }
  const actualSum = backtest.reduce((s, b) => s + b.actualG, 0);
  const errSum = backtest.reduce((s, b) => s + Math.abs(b.forecastG - b.actualG), 0);
  const errorBp = backtest.length > 0 && actualSum > 0 ? Math.round((errSum * 10_000) / actualSum) : null;
  return { method, historyMonths: n, baseG, seasonBp: seasonal, forecast, backtest, errorBp };
}

/** Scale grams by a percent change (−100 .. +500), half up. */
export function scaleByPct(g: number, pct: number): number {
  return Math.max(0, Math.round((g * (100 + pct)) / 100));
}

// ---------------------------------------------------------------------------
// Row 61: die maintenance due
// ---------------------------------------------------------------------------

export function median(xs: readonly number[]): number | null {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid]! : Math.round((v[mid - 1]! + v[mid]!) / 2);
}

/** Kg between consecutive treatments from the cumulative kg at each one (oldest first). */
export function intervalsG(cumAtEvents: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cumAtEvents.length; i++) {
    const d = cumAtEvents[i]! - cumAtEvents[i - 1]!;
    if (d > 0) out.push(d);
  }
  return out;
}

export type IntervalBasis = "copy" | "section" | "plant" | "setting" | "none";
export type DueState = "due" | "soon" | "ok" | "unknown";

export type DueEstimate = {
  basis: IntervalBasis;
  /** Typical kg between treatments (grams) and how many past intervals it is the median of. */
  intervalG: number | null;
  samples: number;
  sinceG: number;
  leftG: number | null;
  /** Days left at the copy's recent pace; null without a pace or an interval. */
  daysLeft: number | null;
  state: DueState;
};

/**
 * When a copy is next due for a treatment: the median kg between its own past treatments (two or
 * more intervals), else its section's, else the plant's, else the plant setting. `sinceG` is the good
 * kg pressed since the last one (or since the copy came, when it never had one).
 */
export function dueEstimate(o: {
  sinceG: number;
  copyIntervals: readonly number[];
  sectionIntervals: readonly number[];
  plantIntervals: readonly number[];
  settingG: number | null;
  gPerDay: number | null;
  soonBp: number;
  soonDays: number;
}): DueEstimate {
  let basis: IntervalBasis = "none";
  let intervalG: number | null = null;
  let samples = 0;
  if (o.copyIntervals.length >= 2) {
    basis = "copy";
    intervalG = median(o.copyIntervals);
    samples = o.copyIntervals.length;
  } else if (o.sectionIntervals.length >= 2) {
    basis = "section";
    intervalG = median(o.sectionIntervals);
    samples = o.sectionIntervals.length;
  } else if (o.plantIntervals.length >= 3) {
    basis = "plant";
    intervalG = median(o.plantIntervals);
    samples = o.plantIntervals.length;
  } else if (o.settingG != null) {
    basis = "setting";
    intervalG = o.settingG;
  }
  if (intervalG == null || intervalG <= 0) return { basis: "none", intervalG: null, samples: 0, sinceG: o.sinceG, leftG: null, daysLeft: null, state: "unknown" };
  const leftG = intervalG - o.sinceG;
  const daysLeft = o.gPerDay != null && o.gPerDay > 0 ? Math.max(0, Math.floor(leftG / o.gPerDay)) : null;
  let state: DueState = "ok";
  if (leftG <= 0) state = "due";
  else if (leftG * 10_000 <= intervalG * o.soonBp || (daysLeft != null && daysLeft <= o.soonDays)) state = "soon";
  return { basis, intervalG, samples, sinceG: o.sinceG, leftG, daysLeft: leftG <= 0 ? 0 : daysLeft, state };
}

export type DriftProjection =
  | { state: "too_few"; readings: number; spanG: number }
  | {
      state: "flat" | "toward_max" | "toward_min";
      readings: number;
      spanG: number;
      /** Grams per 12 ft gained per tonne pressed (the fitted slope), rounded. */
      slopeMilliPerT: number;
      /** The fitted weight now (grams per 12 ft). */
      nowMilli: number;
      /** Kg left before the fitted line leaves the band; 0 when it already has; null when flat. */
      leftG: number | null;
    };

export const DRIFT_MIN_READINGS = 3;
export const DRIFT_MIN_SPAN_G = 2_000_000; // 2 t pressed between the first and last reading

/**
 * A straight line through the copy's kg/12ft readings against the kg it had pressed at each, and
 * where it meets the section band. Needs DRIFT_MIN_READINGS readings over DRIFT_MIN_SPAN_G of pressing.
 */
export function driftProjection(points: readonly { cumG: number; milli: number }[], band: { minMilli: number | null; maxMilli: number | null }, nowCumG: number): DriftProjection {
  const n = points.length;
  const spanG = n > 0 ? Math.max(...points.map((p) => p.cumG)) - Math.min(...points.map((p) => p.cumG)) : 0;
  if (n < DRIFT_MIN_READINGS || spanG < DRIFT_MIN_SPAN_G) return { state: "too_few", readings: n, spanG };
  const mx = points.reduce((s, p) => s + p.cumG, 0) / n;
  const my = points.reduce((s, p) => s + p.milli, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.cumG - mx) ** 2;
    sxy += (p.cumG - mx) * (p.milli - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0; // milli per gram
  const nowMilli = Math.round(my + slope * (nowCumG - mx));
  const slopeMilliPerT = Math.round(slope * 1_000_000);
  if (slopeMilliPerT === 0) return { state: "flat", readings: n, spanG, slopeMilliPerT: 0, nowMilli, leftG: null };
  const limit = slope > 0 ? band.maxMilli : band.minMilli;
  const state = slope > 0 ? "toward_max" : "toward_min";
  if (limit == null) return { state, readings: n, spanG, slopeMilliPerT, nowMilli, leftG: null };
  const leftG = Math.max(0, Math.round((limit - nowMilli) / slope));
  return { state, readings: n, spanG, slopeMilliPerT, nowMilli, leftG };
}
