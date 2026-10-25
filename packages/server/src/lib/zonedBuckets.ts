/**
 * Calendar buckets on a company's wall clock, computed inside SQL (analytics addendum A4).
 *
 * SQLite has no IANA timezone support, so the server works out the zone's UTC offset over the
 * queried range (one segment per DST change; IST has exactly one) and SQL shifts each timestamp
 * by that offset before `date()` / `strftime()` read the calendar parts. The offsets and segment
 * edges are integers computed here, inlined as SQL literals, so bucketing costs no bound
 * parameters and every statement stays well under D1's limit of 100.
 *
 * Dates on the wire are company-local calendar dates `YYYY-MM-DD`; months are `YYYY-MM`.
 */
import { sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import { zonedMidnightMs, zonedOffsetMs, zonedYmd } from "./dayWindow";

export type BucketUnit = "day" | "week" | "month";

const DAY_MS = 86_400_000;

/** One stretch of constant UTC offset: applies to instants < `untilMs` (null = to the end). */
export type OffsetSegment = { untilMs: number | null; offsetMs: number };

// ── calendar arithmetic on YYYY-MM-DD (pure, no timezone) ───────────────────

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

function fromUtcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return fromUtcDate(new Date(Date.UTC(y, m - 1, d + n)));
}

export function addMonths(date: string, n: number): string {
  const [y, m] = parts(date);
  return fromUtcDate(new Date(Date.UTC(y, m - 1 + n, 1)));
}

/** `date` + n calendar years (29 Feb rolls to 1 Mar). */
export function addYears(date: string, n: number): string {
  const [y, m, d] = parts(date);
  return fromUtcDate(new Date(Date.UTC(y + n, m - 1, d)));
}

/** Whole calendar days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

/** Start of the bucket containing `date`: itself, its Monday (ISO week) or the 1st of its month. */
export function bucketStartOf(date: string, unit: BucketUnit): string {
  if (unit === "day") return date;
  if (unit === "month") return `${date.slice(0, 7)}-01`;
  const [y, m, d] = parts(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Every bucket start overlapping the local-date range [from, to), oldest first. */
export function bucketStarts(from: string, to: string, unit: BucketUnit): string[] {
  const out: string[] = [];
  for (let b = bucketStartOf(from, unit); b < to; ) {
    out.push(b);
    b = unit === "day" ? addDays(b, 1) : unit === "week" ? addDays(b, 7) : addMonths(b, 1);
  }
  return out;
}

/** The company-local calendar date of instant `ms`. */
export function localDate(timezone: string, ms: number): string {
  const { year, month, day } = zonedYmd(timezone, ms);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** UTC instant of local midnight at the start of `date` in `timezone`. */
export function localMidnight(timezone: string, date: string): number {
  const [year, month, day] = parts(date);
  return zonedMidnightMs(timezone, { year, month, day });
}

// ── offsets over a range ─────────────────────────────────────────────────────

/**
 * The zone's offset segments over [startMs, endMs]. Samples every 7 days (no zone changes its
 * offset twice within a week) and binary-searches each change to the second.
 */
export function offsetSegments(timezone: string, startMs: number, endMs: number): OffsetSegment[] {
  const STEP = 7 * DAY_MS;
  const segments: OffsetSegment[] = [];
  let at = startMs;
  let offset = zonedOffsetMs(timezone, at);
  while (at < endMs) {
    const next = Math.min(at + STEP, endMs);
    const nextOffset = zonedOffsetMs(timezone, next);
    if (nextOffset !== offset) {
      // First instant (to the second) carrying the new offset.
      let lo = at;
      let hi = next;
      while (hi - lo > 1000) {
        const mid = Math.floor((lo + hi) / 2000) * 1000;
        if (mid <= lo) break;
        if (zonedOffsetMs(timezone, mid) === offset) lo = mid;
        else hi = mid;
      }
      segments.push({ untilMs: hi, offsetMs: offset });
      offset = nextOffset;
    }
    at = next;
  }
  segments.push({ untilMs: null, offsetMs: offset });
  return segments;
}

function literal(n: number): SQL {
  if (!Number.isSafeInteger(n)) throw new Error(`not an integer: ${n}`);
  return sql.raw(String(n));
}

/** `col` (epoch ms) shifted onto the wall clock, still in ms. */
export function localMsExpr(col: SQLiteColumn | SQL, segments: OffsetSegment[]): SQL<number> {
  if (segments.length === 1) return sql<number>`(${col} + ${literal(segments[0]!.offsetMs)})`;
  const whens = segments
    .slice(0, -1)
    .map((s) => sql`when ${col} < ${literal(s.untilMs!)} then ${literal(s.offsetMs)}`);
  const last = literal(segments.at(-1)!.offsetMs);
  return sql<number>`(${col} + case ${sql.join(whens, sql` `)} else ${last} end)`;
}

/**
 * Bucket key of `col` on the wall clock: `YYYY-MM-DD` for day and week (the Monday on or before),
 * `YYYY-MM-01` for month. Matches `bucketStarts`.
 */
export function bucketKeyExpr(col: SQLiteColumn | SQL, segments: OffsetSegment[], unit: BucketUnit): SQL<string> {
  const seconds = sql`(${localMsExpr(col, segments)} / 1000)`;
  if (unit === "day") return sql<string>`date(${seconds}, 'unixepoch')`;
  if (unit === "month") return sql<string>`strftime('%Y-%m-01', ${seconds}, 'unixepoch')`;
  return sql<string>`date(${seconds}, 'unixepoch', '-6 days', 'weekday 1')`;
}

/**
 * Production-day key of `col` (BACKLOG 20): the calendar date of (wall clock - `startMin`), so a
 * moment before shift 1's start belongs to the day before. `startMin` 0 is `bucketKeyExpr(..., "day")`.
 */
export function productionDayKeyExpr(col: SQLiteColumn | SQL, segments: OffsetSegment[], startMin: number): SQL<string> {
  const seconds = sql`((${localMsExpr(col, segments)} - ${literal(startMin * 60_000)}) / 1000)`;
  return sql<string>`date(${seconds}, 'unixepoch')`;
}

/** A local-date range [from, to) as UTC instants plus the offsets that cover it. */
export function zonedRange(timezone: string, from: string, to: string) {
  const fromMs = localMidnight(timezone, from);
  const toMs = localMidnight(timezone, to);
  return { fromMs, toMs, segments: offsetSegments(timezone, fromMs, toMs) };
}
