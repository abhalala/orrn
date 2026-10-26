/**
 * Periods for customer analytics (analytics addendum §4, ruling R33): the leaderboard, the list's
 * kg column and a customer's KPI tiles all read the same period, picked in one page-level row.
 *
 * Dates are company-local calendar days `YYYY-MM-DD`; `to` is an inclusive day (ruling RP10), so
 * every period ends today. Quarters are Indian financial quarters (Apr, Jul, Oct, Jan), which share
 * their edges with calendar quarters; the financial year starts on 1 April. The default period is
 * this financial year to date (Q-A2 default).
 */
import type { MessageKey, Translate } from "@orrn/i18n";

export const PERIODS = ["month", "quarter", "fy"] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = "fy";

const FALLBACK_ZONE = "Asia/Kolkata";

/** `settings.timezone` when it is a string, IST otherwise (the server's own default). */
export function companyTimeZone(settings: { [key: string]: unknown } | null | undefined): string {
  const tz = settings?.timezone;
  return typeof tz === "string" && tz.length > 0 ? tz : FALLBACK_ZONE;
}

function ymdIn(timeZone: string, at: Date): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Today's calendar day in the company's zone; an unknown zone reads as IST instead of throwing. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  try {
    return ymdIn(timeZone, now);
  } catch {
    return ymdIn(FALLBACK_ZONE, now);
  }
}

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function ymd(y: number, m: number, d: number): string {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}

/** The period's first day through today (inclusive). */
export function periodRange(period: Period, today: string): { from: string; to: string } {
  const [y, m] = parts(today);
  if (period === "month") return { from: ymd(y, m, 1), to: today };
  if (period === "quarter") return { from: ymd(y, m - ((m - 1) % 3), 1), to: today };
  return { from: m >= 4 ? ymd(y, 4, 1) : ymd(y - 1, 4, 1), to: today };
}

/** The last `months` calendar months, this (open) month last, for a monthly volume chart. */
export function trailingMonths(today: string, months = 12): { from: string; to: string; monthStarts: string[] } {
  const [y, m] = parts(today);
  const monthStarts = Array.from({ length: months }, (_, i) => ymd(y, m - (months - 1) + i, 1));
  return { from: monthStarts[0]!, to: today, monthStarts };
}

/** Search-param reader: an unknown value is the default period, never an error page. */
export function parsePeriod(value: unknown): Period {
  return PERIODS.includes(value as Period) ? (value as Period) : DEFAULT_PERIOD;
}

/** Label key per period (the segmented control). */
export const PERIOD_LABEL: Record<Period, MessageKey> = {
  month: "customers.period.month",
  quarter: "customers.period.quarter",
  fy: "customers.period.fy",
};

/** "Today", "Yesterday", "12 days ago", or "No dispatches yet". */
export function lastDispatchPhrase(daysSinceLast: number | null): { key: MessageKey; count?: number } {
  if (daysSinceLast === null) return { key: "customers.detail.lastNever" };
  if (daysSinceLast <= 0) return { key: "customers.detail.lastToday" };
  if (daysSinceLast === 1) return { key: "customers.detail.lastYesterday" };
  return { key: "customers.detail.lastDaysAgo", count: daysSinceLast };
}

/** The median gap between dispatches as whole days ("every ~9 days"), at least one. */
export function cadenceDays(median: number | null): number | null {
  if (median === null) return null;
  return Math.max(1, Math.round(median));
}

/**
 * The facts line under a customer's name: "Last dispatch 12 days ago · every ~9 days". The cadence
 * needs two dispatches, so with one the last dispatch stands alone.
 */
export function customerFactsLine(t: Translate, facts: { daysSinceLast: number | null; cadenceDays: number | null }): string {
  const last = lastDispatchPhrase(facts.daysSinceLast);
  const lastText = t(last.key, last.count === undefined ? undefined : { count: last.count });
  const cadence = facts.daysSinceLast === null ? null : cadenceDays(facts.cadenceDays);
  return cadence === null ? lastText : `${lastText} · ${t("customers.detail.cadence", { count: cadence })}`;
}
