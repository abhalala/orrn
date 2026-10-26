/**
 * View models for the reports (W4-ANALYTICS). Every figure is the server's (grams, basis points,
 * paise, the server's `…Pct` strings); this file only writes them down, builds the CSV text from the
 * same rows the table shows, and maps answers onto chart bars. No arithmetic on kg or percents
 * beyond unit conversion for display.
 */
import type { MessageKey, TranslateVars } from "@orrn/i18n";
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

import type { OrdersReportSearch } from "./search";

type Outputs = inferRouterOutputs<AppRouter>;
export type RecoveryData = Outputs["analytics"]["recovery"];
export type DieLifeData = Outputs["analytics"]["dieLife"];
export type DieLifeItem = DieLifeData["items"][number];
export type StockAgeData = Outputs["analytics"]["stockAge"];
export type OrdersData = Outputs["analytics"]["orders"];
export type OrdersRow = OrdersData["rows"][number];

type T = (key: MessageKey, vars?: TranslateVars) => string;

const KG3 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const KG0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const RS = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COUNT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });

/** Grams as kg to the gram, Indian grouping: "1,280.000". */
export const kgText = (g: number): string => KG3.format(g / 1000);
/** Grams as whole kg for a tile or the die card: "60,000". */
export const kgWholeText = (g: number): string => KG0.format(Math.round(g / 1000));
/** Paise as rupees: "3,00,000.00". */
export const rupeeText = (paise: number): string => RS.format(paise / 100);
/** Indian-grouped count. */
export const countText = (n: number): string => COUNT.format(n);
// ── CSV ────────────────────────────────────────────────────────────────────

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * One CSV cell. A text cell that starts with = + - @ (or a tab / CR) would run as a formula in
 * Excel, so it is written as text with a leading '; numbers and number strings ("-5.250") are left
 * alone.
 */
function cell(v: string | number | null | undefined): string {
  let s = v == null ? "" : String(v);
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Plain kg in a CSV cell (no grouping, so a spreadsheet reads it as a number). */
const csvKg = (g: number) => (g / 1000).toFixed(3);
const csvRs = (paise: number) => (paise / 100).toFixed(2);

export function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return [header.map(cell).join(","), ...rows.map((r) => r.map(cell).join(","))].join("\n") + "\n";
}

/** File name: `{name}-{from}[-{to}].csv`. */
export function csvFileName(name: string, from?: string, to?: string): string {
  const range = from ? (to && to !== from ? `-${from}-${to}` : `-${from}`) : "";
  return `${name}${range}.csv`;
}

// ── recovery ───────────────────────────────────────────────────────────────

export const RECOVERY_GROUPS = ["die", "copy", "press", "shift"] as const;
export type RecoveryGroup = (typeof RECOVERY_GROUPS)[number];

/** The row's name: a die shows `12170 Domal`, a press `P1 Press 1`, a copy `12170-1`, a shift its name. */
export function recoveryLabel(r: { label: string; detail: string | null }, group: RecoveryGroup, t: T): string {
  if (!r.label) return t("reports.production.none");
  if ((group === "die" || group === "press") && r.detail) return `${r.label} ${r.detail}`;
  return r.label;
}

export function recoveryCsv(data: RecoveryData, t: T): string {
  const group = data.groupBy as RecoveryGroup;
  const header = [
    t(`reports.production.group.${group}`),
    t("reports.production.runs"),
    t("reports.production.input"),
    t("reports.production.good"),
    t("reports.production.scrap"),
    t("reports.production.recovery"),
  ];
  const rows = data.rows.map((r) => [recoveryLabel(r, group, t), r.runs, csvKg(r.inputG), csvKg(r.goodG), csvKg(r.scrapG), r.recoveryPct ?? ""]);
  rows.push([t("reports.total"), data.totals.runs, csvKg(data.totals.inputG), csvKg(data.totals.goodG), csvKg(data.totals.scrapG), data.totals.recoveryPct ?? ""]);
  return toCsv(header, rows);
}

/** Recovery bars (percent, one decimal from the server's text); rows with no input are left out. */
export function recoveryBars(data: RecoveryData, t: T) {
  const group = data.groupBy as RecoveryGroup;
  return data.rows
    .filter((r) => r.recoveryPct != null)
    .map((r) => ({ key: r.key || "none", label: recoveryLabel(r, group, t), short: r.label || t("reports.production.none"), value: Number(r.recoveryPct) }));
}

// ── die life ───────────────────────────────────────────────────────────────

export type LifeTone = "neutral" | "green" | "amber" | "red";

export function lifeTone(state: DieLifeItem["state"]): LifeTone {
  return state === "reached" ? "red" : state === "near" ? "amber" : state === "ok" ? "green" : "neutral";
}

/** The chip under "Used": "Life reached", "94.7 % used", or "No life set". */
export function lifeChip(item: Pick<DieLifeItem, "state" | "usedPct">, t: T): string {
  if (item.state === "none" || item.usedPct == null) return t("reports.dieLife.noLife");
  if (item.state === "reached") return `${t("reports.dieLife.reached")} · ${t("reports.dieLife.usedPct", { pct: item.usedPct })}`;
  return t("reports.dieLife.usedPct", { pct: item.usedPct });
}

/** The die card's Runs tab header line. */
export function lifeHeader(item: Pick<DieLifeItem, "state" | "usedPct" | "producedG" | "lifeG">, t: T): string {
  if (item.lifeG == null || item.usedPct == null) return t("reports.dieLife.cardNoLife", { pressed: kgWholeText(item.producedG) });
  return t("reports.dieLife.cardUsed", { pct: item.usedPct, pressed: kgWholeText(item.producedG), life: kgWholeText(item.lifeG) });
}

export function dieLifeCsv(items: readonly DieLifeItem[], t: T, statusLabel: (s: string) => string): string {
  const header = [
    t("reports.dieLife.copy"),
    t("reports.dieLife.section"),
    t("reports.dieLife.status"),
    t("reports.dieLife.life"),
    t("reports.dieLife.pressed"),
    t("reports.dieLife.used"),
    t("reports.dieLife.left"),
    t("reports.dieLife.runs"),
    t("reports.dieLife.lastRun"),
  ];
  return toCsv(
    header,
    items.map((i) => [
      i.code,
      i.sectionName ? `${i.sectionCode} ${i.sectionName}` : i.sectionCode,
      statusLabel(i.status),
      i.lifeG == null ? "" : csvKg(i.lifeG),
      csvKg(i.producedG),
      i.usedPct ?? "",
      i.remainingG == null ? "" : csvKg(i.remainingG),
      i.runs,
      i.lastRunDay ?? "",
    ]),
  );
}

// ── stock age ──────────────────────────────────────────────────────────────

export const AGE_BUCKET_KEYS = ["reports.stockAge.bucket0", "reports.stockAge.bucket1", "reports.stockAge.bucket2", "reports.stockAge.bucket3"] as const satisfies readonly MessageKey[];

export function stockAgeRowName(r: { customerId: string | null; customerName: string | null }, t: T): string {
  if (r.customerId == null) return t("reports.stockAge.plantStock");
  return r.customerName ?? t("reports.stockAge.noName");
}

/** Bars for the age chart: kg per bucket in order (an ordinal ramp; nothing is partial). */
export function stockAgeBars(data: StockAgeData, t: T) {
  return data.buckets.map((b, i) => ({ key: b.key, label: t(AGE_BUCKET_KEYS[i]!), short: b.key, value: b.kgG / 1000 }));
}

export function stockAgeCsv(data: StockAgeData, t: T): string {
  const header = [
    t("reports.stockAge.party"),
    ...AGE_BUCKET_KEYS.flatMap((k) => [`${t(k)} ${t("reports.stockAge.kg")}`, `${t(k)} ${t("reports.stockAge.bundles")}`]),
    `${t("reports.total")} ${t("reports.stockAge.kg")}`,
    `${t("reports.total")} ${t("reports.stockAge.bundles")}`,
  ];
  const rows = data.rows.map((r) => [stockAgeRowName(r, t), ...r.buckets.flatMap((c) => [csvKg(c.kgG), c.bundles]), csvKg(r.kgG), r.bundles]);
  rows.push([t("reports.total"), ...data.buckets.flatMap((b) => [csvKg(b.kgG), b.bundles]), csvKg(data.totals.kgG), data.totals.bundles]);
  return toCsv(header, rows);
}

// ── order book ─────────────────────────────────────────────────────────────

/** The plant's twelve short month names, in the app's language (`reports.monthsShort`). */
export const monthNames = (t: T): string[] => t("reports.monthsShort").split(",");

/** "2026-09" as "Sep 2026" (Latin digits in every language, like the rest of the figures). */
export function monthText(key: string, months: readonly string[]): string {
  const [y, m] = key.split("-").map(Number);
  return y && m && m >= 1 && m <= 12 && months[m - 1] ? `${months[m - 1]} ${y}` : key;
}

export function ordersRowName(r: Pick<OrdersRow, "key" | "label">, group: "customer" | "month", months: readonly string[]): string {
  return group === "month" ? monthText(r.key, months) : r.label;
}

export function ordersCsv(data: OrdersData, t: T, withRates: boolean): string {
  const group = data.groupBy;
  const months = monthNames(t);
  const header = [
    group === "month" ? t("reports.orders.month") : t("reports.orders.party"),
    t("reports.orders.orders"),
    t("reports.orders.late"),
    t("reports.orders.ordered"),
    t("reports.orders.dispatched"),
    t("reports.orders.baki"),
    t("reports.orders.dispatchedShare"),
    ...(withRates ? [t("reports.orders.orderedValue"), t("reports.orders.dispatchedValue"), t("reports.orders.bakiValue")] : []),
  ];
  const rows = data.rows.map((r) => [
    ordersRowName(r, group, months),
    r.orders,
    r.lateOrders,
    csvKg(r.orderedG),
    csvKg(r.dispatchedG),
    csvKg(r.bakiG),
    r.dispatchedPct,
    ...(withRates && r.rates ? [csvRs(r.rates.orderedValuePaise), csvRs(r.rates.dispatchedValuePaise), csvRs(r.rates.bakiValuePaise)] : []),
  ]);
  rows.push([
    t("reports.total"),
    data.sum.orders,
    data.sum.lateOrders,
    csvKg(data.sum.orderedG),
    csvKg(data.sum.dispatchedG),
    csvKg(data.sum.bakiG),
    data.sum.dispatchedPct,
    ...(withRates && data.rateTotals
      ? [csvRs(data.rateTotals.orderedValuePaise), csvRs(data.rateTotals.dispatchedValuePaise), csvRs(data.rateTotals.bakiValuePaise)]
      : []),
  ]);
  return toCsv(header, rows);
}

export type OrderMonthBucket = { key: string; t: Date; orderedG: number; partial: boolean };

const monthIndex = (key: string): number => {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
};
/** A month's start as a Date that reads as that month in any zone (noon UTC on the 1st). */
const monthStart = (index: number): Date => new Date(Date.UTC(Math.floor(index / 12), index % 12, 1, 12));
const monthKey = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/**
 * Ordered kg per order month for the chart, oldest first. Every month from the first to the last
 * is a bucket (a month with no orders is a zero bar, so the axis spacing tells the truth). When
 * the period runs to today (no earlier end date) the company's current month closes the series,
 * even with no orders yet, and is the one open bucket (`partial`): the chart kit's rule for a
 * period that is still running. `today` is the company's calendar day, from the server.
 */
export function orderMonthBuckets(rows: readonly { key: string; orderedG: number }[], opts: { today: string; to?: string }): OrderMonthBucket[] {
  if (rows.length === 0) return [];
  const byKey = new Map(rows.map((r) => [r.key, r.orderedG]));
  const idx = rows.map((r) => monthIndex(r.key));
  const current = monthIndex(opts.today.slice(0, 7));
  const periodEnd = opts.to ? Math.min(current, monthIndex(opts.to.slice(0, 7))) : current;
  const first = Math.min(...idx);
  const last = Math.max(...idx, periodEnd);
  const out: OrderMonthBucket[] = [];
  for (let i = first; i <= last; i += 1) {
    const key = monthKey(i);
    out.push({ key, t: monthStart(i), orderedG: byKey.get(key) ?? 0, partial: i === current });
  }
  return out;
}

/** The buckets as chart bars: dated (`t`), labelled by the chart's own date formatter. */
export function orderMonthBars(buckets: readonly OrderMonthBucket[], dates: { long(d: Date): string; short(d: Date): string }) {
  return buckets.map((b) => ({ key: b.key, label: dates.long(b.t), short: dates.short(b.t), t: b.t, value: b.orderedG / 1000, partial: b.partial }));
}

/** The URL's choices as the `analytics.orders` input: open orders unless the person picks another status. */
export function ordersFilterInput(s: OrdersReportSearch) {
  const status = s.late ? {} : s.show === "closed" || s.show === "cancelled" ? { status: s.show } : s.show === "all" ? {} : { openOnly: true as const };
  return {
    groupBy: s.group ?? ("customer" as const),
    ...status,
    ...(s.late ? { late: true as const } : {}),
    ...(s.party ? { customerId: s.party } : {}),
    ...(s.from ? { dateFrom: s.from } : {}),
    ...(s.to ? { dateTo: s.to } : {}),
  };
}
