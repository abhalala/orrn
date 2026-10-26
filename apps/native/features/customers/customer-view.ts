/**
 * Customer text and periods for the phone; a port of apps/web/src/features/customers/{address,period}.ts
 * (same rules, no web imports). Periods are company-local calendar days; the year is the Indian
 * financial year starting 1 April.
 */
import type { MessageKey, Translate } from "@orrn/i18n";

import { zoneOf } from "@/lib/format";

type Stored = Record<string, unknown> | null | undefined;

function text(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Lines for display: street lines, then "City, State PIN". */
export function addressLines(stored: Stored): string[] {
  if (!stored) return [];
  const place = [text(stored.city).trim(), text(stored.state).trim()].filter(Boolean).join(", ");
  const last = [place, text(stored.postalCode).trim()].filter(Boolean).join(" ");
  return [text(stored.line1).trim(), text(stored.line2).trim(), last].filter(Boolean);
}

export function cityOf(stored: Stored): string {
  return stored ? text(stored.city).trim() : "";
}

export const PERIODS = ["month", "quarter", "fy"] as const;
export type Period = (typeof PERIODS)[number];
export const DEFAULT_PERIOD: Period = "fy";

export const PERIOD_LABEL: Record<Period, MessageKey> = {
  month: "customers.period.month",
  quarter: "customers.period.quarter",
  fy: "customers.period.fy",
};

const FALLBACK_ZONE = "Asia/Kolkata";

/** `settings.timezone` when it is a string, IST otherwise (the server's own default). */
export function companyTimeZone(settings: { [key: string]: unknown } | null | undefined): string {
  return zoneOf(settings);
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

/** "Last dispatch 12 days ago, every ~9 days". The cadence needs two dispatches. */
export function customerFactsLine(t: Translate, facts: { daysSinceLast: number | null; cadenceDays: number | null }): string {
  const last = lastDispatchPhrase(facts.daysSinceLast);
  const lastText = t(last.key, last.count === undefined ? undefined : { count: last.count });
  const cadence = facts.daysSinceLast === null ? null : cadenceDays(facts.cadenceDays);
  return cadence === null ? lastText : `${lastText}, ${t("customers.detail.cadence", { count: cadence })}`;
}

/** A `YYYY-MM-DD` calendar day as a local Date, so the phone formatter prints the same day. */
export function ymdToDate(value: string): Date {
  const [y, m, d] = parts(value);
  return new Date(y, m - 1, d);
}
