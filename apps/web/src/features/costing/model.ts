/**
 * Costing screens as plain functions (XE parity lane COST): words for percents, hours and bases, the CSV text built
 * from the rows the tables show, and the settings form turned into a `costing.settings.update` input.
 * Every figure is the server's (grams, basis points, paise, minutes); nothing is recomputed here beyond a share of
 * two server totals. Money is typed in rupees and sent in paise; percents are typed and sent in basis points.
 */
import { COST_STAGES, MAX_COST_PAISE, withoutGrouping, type CostStage } from "@orrn/domain";
import type { MessageKey, TranslateVars } from "@orrn/i18n";

import { hundredths, percentToBp } from "@/features/pricing/master/rate-model";
import { toCsv } from "@/features/reports/model";

import type { CapacityView, CostSettingsView, DieRow, ForecastRow, ProfitView, RunView, SectionsView } from "./hooks";

export type T = (key: MessageKey, vars?: TranslateVars) => string;

/** Exports stay in kg whatever the plant shows on screen (units in the headers, numbers in those units). */
const exportWords = (t: T): T => (key, vars) => t(key, { massUnit: "kg", ...vars });

const csvKg = (g: number) => (g / 1000).toFixed(3);
const csvRs = (paise: number) => (paise / 100).toFixed(2);

/* ------------------------------ words for figures ------------------------------ */

/** "800" bp -> "8%"; "1250" -> "12.5%"; negative margins keep their sign; null is a dash. */
export function bpText(bp: number | null | undefined): string {
  if (bp == null) return "-";
  const abs = Math.abs(Math.round(bp));
  const whole = Math.floor(abs / 100);
  const rest = abs % 100;
  const num = rest === 0 ? String(whole) : `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
  return `${bp < 0 ? "-" : ""}${num}%`;
}

/** Minutes as hours with one decimal ("90" -> "1.5"). */
export function hoursText(minutes: number): string {
  return (Math.round((minutes / 60) * 10) / 10).toFixed(1);
}

/** The share of `part` in `whole` as basis points (the server's two totals), null when there is no whole. */
export function lowMarginShareBp(lowKgG: number, costedKgG: number): number | null {
  return costedKgG > 0 ? Math.round((lowKgG * 10_000) / costedKgG) : null;
}

/** Costed grams of a profit row: ordered less what had no rate or no cost. */
export const costedG = (r: { kgG: number; noRateKgG: number; noCostKgG: number }): number => Math.max(0, r.kgG - r.noRateKgG - r.noCostKgG);

/** Stage words for a list of missing stages, in the order the server sent. */
export function stageNames(stages: readonly string[], t: T): string {
  return stages.map((s) => t(`cost.stage.${s as CostStage | "metal"}`)).join(", ");
}

/** "Average of the last 3 months" and the others. */
export const methodText = (method: "ma3" | "ma3_seasonal" | "too_little", t: T): string => t(`cost.method.${method}`);

/** Where a cost came from, biggest share first: "its own runs (1,200 kg), the plant's recent runs (300 kg)". */
export function costBasisNote(bases: Readonly<Record<string, number>>, t: T, kg: (g: number) => string): string {
  return Object.entries(bases)
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .map(([b, g]) => t("cost.profit.basisPart", { what: t(`cost.basis.${b as "actual"}`), kg: kg(g) }))
    .join(", ");
}

export type DueState = "due" | "soon" | "ok" | "unknown";
export const dueTone = (s: DueState): "red" | "amber" | "green" | "neutral" => (s === "due" ? "red" : s === "soon" ? "amber" : s === "ok" ? "green" : "neutral");

type Say = { t: T; kg: (g: number) => string };

/** A copy's nitriding or correction estimate as lines: the interval and its basis, kg since, days left. */
export function dueLines(e: DieRow["nitride"], say: Say): string[] {
  const { t, kg } = say;
  if (e.state === "unknown" || e.intervalG == null) return [t("cost.dies.noTreatments")];
  const out = [t("cost.dies.since", { kg: kg(e.sinceG) })];
  out.push(t("cost.dies.interval", { kg: kg(e.intervalG), basis: t(`cost.dies.basis.${e.basis}`, { n: e.samples }) }));
  out.push(e.daysLeft == null ? t("cost.dies.noPace") : t("cost.dies.daysLeft", { n: e.daysLeft }));
  return out;
}

/** The drift line under a copy. `needG` is the pressing span a fit needs (the server's constant, shown, never used to decide). */
export function driftLine(d: DieRow["drift"], say: Say, needG = 2_000_000, needReadings = 3): string {
  const { t, kg } = say;
  if (d.state === "too_few") return t("cost.dies.driftFew", { n: needReadings, kg: kg(needG), have: d.readings });
  // Outside the band first: a flat line outside it is still out.
  if (d.leftG != null && d.leftG <= 0) return t("cost.dies.driftOut");
  if (d.state === "flat") return t("cost.dies.driftFlat");
  if (d.leftG == null) return t("cost.dies.driftNoLimit");
  return t("cost.dies.driftLeft", { kg: kg(d.leftG) });
}

/** The metal of a run in one line: cast cost with its cast numbers, or the price master rate with its date and factors. */
export function metalLine(m: RunView["metal"], say: Say & { rate: (paise: number) => string; day: (ymd: string) => string }): string {
  const { t, rate } = say;
  if (m.paisePerBilletKg == null || m.basis === "none") return t("cost.cost.metalNone");
  const per = rate(m.paisePerBilletKg);
  if (m.basis === "cast") {
    const list = m.casts.map((c) => c.number).filter(Boolean).join(", ");
    return t("cost.cost.cast", { casts: list ? t("cost.cost.castList", { list }) : "", rate: per });
  }
  return t("cost.cost.master", {
    list: m.listPaisePerKg == null ? "-" : rate(m.listPaisePerKg),
    date: m.rateDate ? say.day(m.rateDate) : "-",
    yield: bpText(m.meltYieldBp),
    share: bpText(m.boughtShareBp),
    rate: per,
  });
}

/** One stage line of a run: its rate per good kg and why it is not plain. */
export function stageLine(s: RunView["stages"][number], say: Say & { rate: (paise: number) => string }): string {
  const { t } = say;
  const stage = t(`cost.stage.${s.stage}`);
  const note = s.note ? ` (${t(`cost.cost.note.${s.note}`)})` : "";
  if (s.paisePerKg == null) return `${stage}: ${s.note ? t(`cost.cost.note.${s.note}`) : t("cost.cost.unknown")}`;
  const basis = s.basis === "hour" ? `, ${t("cost.cost.stageBasisHour")}` : s.basis === "kg" ? `, ${t("cost.cost.stageBasisKg")}` : "";
  return `${t("cost.cost.stageLine", { stage, rate: say.rate(s.paisePerKg) })}${basis}${note}`;
}

/* ------------------------------ CSV ------------------------------ */

export function costCsv(data: SectionsView, t: T): string {
  t = exportWords(t);
  const header = [
    t("cost.cost.section"),
    t("cost.cost.runs"),
    t("cost.cost.good"),
    t("cost.cost.recovery"),
    t("cost.cost.metal"),
    ...COST_STAGES.map((s) => t(`cost.stage.${s}`)),
    t("cost.cost.total"),
  ];
  const line = (name: string, r: SectionsView["total"]) => [
    name,
    r.runs,
    csvKg(r.goodG),
    r.recoveryBp == null ? "" : (r.recoveryBp / 100).toFixed(2),
    r.metalPaisePerKg == null ? "" : csvRs(r.metalPaisePerKg),
    ...COST_STAGES.map((s) => (r.stages[s] == null ? "" : csvRs(r.stages[s]!))),
    r.totalPaisePerKg == null ? "" : csvRs(r.totalPaisePerKg),
  ];
  return toCsv(header, [...data.rows.map((r) => line(r.sectionCode, r)), line(t("cost.total"), data.total)]);
}

export function profitCsv(data: ProfitView, t: T, months: readonly string[], monthName: (key: string, months: readonly string[]) => string): string {
  t = exportWords(t);
  const header = [
    t(`cost.profit.${data.groupBy === "section" ? "bySection" : data.groupBy === "customer" ? "byCustomer" : "byMonth"}`),
    t("cost.profit.lines"),
    t("cost.profit.kg"),
    t("cost.profit.revenue"),
    t("cost.profit.costCol"),
    t("cost.profit.margin"),
    t("cost.profit.marginPct"),
    t("cost.profit.lowKg"),
  ];
  const line = (name: string, r: ProfitView["total"]) => [
    name,
    r.lines,
    csvKg(r.kgG),
    csvRs(r.revenuePaise),
    r.costPaise == null ? "" : csvRs(r.costPaise),
    r.marginPaise == null ? "" : csvRs(r.marginPaise),
    r.marginBp == null ? "" : (r.marginBp / 100).toFixed(2),
    csvKg(r.lowKgG),
  ];
  return toCsv(header, [
    ...data.rows.map((r) => line(data.groupBy === "month" ? monthName(r.key, months) : r.label, r)),
    line(t("cost.total"), data.total),
  ]);
}

export function forecastCsv(rows: readonly ForecastRow[], t: T, groupLabel: string): string {
  t = exportWords(t);
  const header = [groupLabel, t("cost.forecast.last12"), t("cost.forecast.method"), t("cost.forecast.next"), t("cost.forecast.error")];
  return toCsv(
    header,
    rows.map((r) => [
      r.label || t("cost.forecast.plant"),
      csvKg(r.last12G),
      methodText(r.method, t),
      r.forecast.map((f) => `${f.month} ${csvKg(f.g)}`).join("; "),
      r.errorBp == null ? "" : (r.errorBp / 100).toFixed(2),
    ]),
  );
}

export const csvFile = (name: string, from?: string, to?: string): string => {
  const range = from ? (to && to !== from ? `-${from}-${to}` : `-${from}`) : "";
  return `${name}${range}.csv`;
};

/* ------------------------------ capacity ------------------------------ */

/** Over-booked weeks per press, for the "causes" line and the Outlook count. */
export function fullestWeek(data: Pick<CapacityView, "lines">): { line: CapacityView["lines"][number]; week: CapacityView["lines"][number]["weeks"][number] } | null {
  let best: ReturnType<typeof fullestWeek> = null;
  for (const line of data.lines) {
    for (const week of line.weeks) {
      if (!week.over) continue;
      if (!best || (week.loadBp ?? 0) > (best.week.loadBp ?? 0)) best = { line, week };
    }
  }
  return best;
}

/** What-if percent typed as a whole number from -100 to 500; null for anything else. */
export function scenarioPct(raw: string): number | null {
  const s = raw.trim().replace(/^\+/, "");
  if (!/^-?\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= -100 && n <= 500 ? n : null;
}

/* ------------------------------ settings form ------------------------------ */

/** A whole number from typed text within a range ("1,000" groups are fine); null otherwise. */
export function wholeIn(raw: string, min: number, max: number): number | null {
  const c = withoutGrouping(raw.trim());
  if (c === null || !/^\d+$/.test(c)) return null;
  const n = Number(c);
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : null;
}

/** Rupees typed ("8.50") as whole paise, 0 up to the server's ceiling; null otherwise. */
export function rupeesToPaise(raw: string): number | null {
  const n = hundredths(raw);
  return n !== null && n <= MAX_COST_PAISE ? n : null;
}

export const paiseToRupees = (paise: number): string => (paise % 100 === 0 ? String(paise / 100) : (paise / 100).toFixed(2));

export type SettingsForm = {
  lowMargin: string;
  workDays: string;
  hoursPerDay: string;
  downtimePlant: string;
  downtimeLine: Record<string, string>;
  defaultSpeed: string;
  leadDays: string;
  nitrideEvery: string;
  correctEvery: string;
  soonPct: string;
  soonDays: string;
};

const bpPct = (bp: number) => bpText(bp).replace("%", "");

export function settingsForm(s: Pick<CostSettingsView, "lowMarginBp" | "workDaysPerWeek" | "hoursPerDay" | "downtimeHoursPerWeek" | "lineDowntimeHours" | "defaultKgPerHour" | "leadDays" | "nitrideEveryKg" | "correctEveryKg" | "dieSoonBp" | "dieSoonDays">): SettingsForm {
  return {
    lowMargin: bpPct(s.lowMarginBp),
    workDays: String(s.workDaysPerWeek),
    hoursPerDay: String(s.hoursPerDay),
    downtimePlant: String(s.downtimeHoursPerWeek),
    downtimeLine: Object.fromEntries(Object.entries(s.lineDowntimeHours).map(([k, v]) => [k, String(v)])),
    defaultSpeed: s.defaultKgPerHour == null ? "" : String(s.defaultKgPerHour),
    leadDays: String(s.leadDays),
    nitrideEvery: s.nitrideEveryKg == null ? "" : String(s.nitrideEveryKg),
    correctEvery: s.correctEveryKg == null ? "" : String(s.correctEveryKg),
    soonPct: bpPct(s.dieSoonBp),
    soonDays: String(s.dieSoonDays),
  };
}

export type SettingsUpdate = {
  lowMarginBp: number;
  workDaysPerWeek: number;
  hoursPerDay: number;
  downtimeHoursPerWeek: number;
  lineDowntimeHours: Record<string, number>;
  defaultKgPerHour: number | null;
  leadDays: number;
  nitrideEveryKg: number | null;
  correctEveryKg: number | null;
  dieSoonBp: number;
  dieSoonDays: number;
};

/** The form as the server wants it, or the names of the fields that are not numbers. Empty optional boxes become null. */
export function settingsUpdate(f: SettingsForm): { ok: true; input: SettingsUpdate } | { ok: false; bad: (keyof SettingsForm)[] } {
  const bad: (keyof SettingsForm)[] = [];
  const need = <V,>(key: keyof SettingsForm, v: V | null): V => {
    if (v === null) bad.push(key);
    return v as V;
  };
  const optional = (key: keyof SettingsForm, raw: string, max: number): number | null => {
    if (raw.trim() === "") return null;
    return need(key, wholeIn(raw, 1, max));
  };
  const lineDowntimeHours: Record<string, number> = {};
  for (const [id, raw] of Object.entries(f.downtimeLine)) {
    if (raw.trim() === "") continue;
    const n = wholeIn(raw, 0, 168);
    if (n === null) bad.push("downtimeLine");
    else lineDowntimeHours[id] = n;
  }
  const input: SettingsUpdate = {
    lowMarginBp: need("lowMargin", percentToBp(f.lowMargin)),
    workDaysPerWeek: need("workDays", wholeIn(f.workDays, 1, 7)),
    hoursPerDay: need("hoursPerDay", wholeIn(f.hoursPerDay, 1, 24)),
    downtimeHoursPerWeek: need("downtimePlant", wholeIn(f.downtimePlant, 0, 168)),
    lineDowntimeHours,
    defaultKgPerHour: optional("defaultSpeed", f.defaultSpeed, 100_000),
    leadDays: need("leadDays", wholeIn(f.leadDays, 0, 365)),
    nitrideEveryKg: optional("nitrideEvery", f.nitrideEvery, 10_000_000),
    correctEveryKg: optional("correctEvery", f.correctEvery, 10_000_000),
    dieSoonBp: need("soonPct", percentToBp(f.soonPct)),
    dieSoonDays: need("soonDays", wholeIn(f.soonDays, 0, 365)),
  };
  return bad.length > 0 ? { ok: false, bad } : { ok: true, input };
}

export type RateRowForm = { amount: string; basis: "kg" | "hour"; kgPerHour: string };
export type RateForm = { from: string; stages: Record<CostStage, RateRowForm> };

export const emptyRateForm = (from: string): RateForm => ({
  from,
  stages: Object.fromEntries(COST_STAGES.map((s) => [s, { amount: "", basis: "kg", kgPerHour: "" }])) as RateForm["stages"],
});

export type RateVersionInput = { from: string; stages: Partial<Record<CostStage, { basis: "kg" | "hour"; paise: number; kgPerHour: number | null }>> };

/** A dated rate version from the form. A stage with an empty amount is left out (counted as 0 by the server). */
export function rateVersion(f: RateForm): { ok: true; input: RateVersionInput } | { ok: false; error: "date" | "amount" | "throughput"; stage?: CostStage } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from)) return { ok: false, error: "date" };
  const stages: RateVersionInput["stages"] = {};
  for (const s of COST_STAGES) {
    const r = f.stages[s];
    if (r.amount.trim() === "") continue;
    const paise = rupeesToPaise(r.amount);
    if (paise === null) return { ok: false, error: "amount", stage: s };
    let kph: number | null = null;
    if (r.basis === "hour" && s !== "extrusion") {
      kph = wholeIn(r.kgPerHour, 1, 1_000_000);
      if (kph === null) return { ok: false, error: "throughput", stage: s };
    }
    stages[s] = { basis: r.basis, paise, kgPerHour: kph };
  }
  return { ok: true, input: { from: f.from, stages } };
}

/** A past version, one line per stage with a rate, for the list. */
export function versionRows(v: CostSettingsView["rates"][number], t: T, money: (paise: number) => string): { stage: CostStage; text: string }[] {
  const out: { stage: CostStage; text: string }[] = [];
  for (const s of COST_STAGES) {
    const r = v.stages[s];
    if (!r) continue;
    const amount = money(r.paise);
    const text = r.basis === "kg" ? t("cost.settings.rateKg", { amount }) : r.kgPerHour != null ? t("cost.settings.rateHourKph", { amount, kph: r.kgPerHour }) : t("cost.settings.rateHour", { amount });
    out.push({ stage: s, text });
  }
  return out;
}

/* ------------------------------ what-if and paging ------------------------------ */

export type ScenarioCustomer = { customerId: string; name: string; pct: number };

/** The server takes at most this many customers in one what-if. */
export const MAX_SCENARIO = 10;

/**
 * Add or change one customer's percent. At the limit a new customer is refused (`full`), never
 * dropped; a customer already on the list can still be changed.
 */
export function addScenario(list: readonly ScenarioCustomer[], next: ScenarioCustomer): { list: ScenarioCustomer[]; full: boolean } {
  const known = list.some((w) => w.customerId === next.customerId);
  if (!known && list.length >= MAX_SCENARIO) return { list: [...list], full: true };
  return { list: known ? list.map((w) => (w.customerId === next.customerId ? next : w)) : [...list, next], full: false };
}

/** The runs list grows 20 at a time up to the server's page limit (200). */
export const RUNS_STEP = 20;
export const RUNS_MAX = 200;
export const nextRunsLimit = (limit: number) => Math.min(RUNS_MAX, limit + RUNS_STEP);

/** A stale save (someone else saved the settings first): the server answers CONFLICT. */
export function isConflict(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null | undefined)?.data?.code === "CONFLICT";
}
