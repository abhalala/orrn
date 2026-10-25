/**
 * Shared pieces of the dev seed modules (`dev-seed*.ts`): the Db type, the demo company id, time
 * helpers and the chunked insert. Pure (no Workers runtime), so every module can import it.
 *
 * Time: the seed never writes a fixed date. `seedClock` is built from `now` and the demo shifts and
 * gives (a) calendar-day helpers (`pastAt`) and (b) production-day helpers (`dayAt`), where the
 * production day is the window the dashboard, pack and the press report read
 * (`productionDayWindow`: shift 1's start to the next, 08:00 to 08:00 for the demo). Anything that
 * must show as "today" goes through `dayAt`, so it never falls into the previous night shift (7f172a70).
 */
import type { createDb } from "@orrn/db";
import type { BundleStatus } from "@orrn/db/schema/inventory";
import { getTableColumns } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { productionDayWindow } from "@orrn/server/lib/dayWindow";

export type Db = ReturnType<typeof createDb>;
export type Statement = BatchItem<"sqlite">;

/** D1 rejects statements with more than 100 bound parameters. */
export const MAX_PARAMS = 100;
export const COMPANY_ID = "dev-company-orrn";
export const IST_OFFSET_MS = 330 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const LENGTH_12FT_MM = 3658;
export const LENGTH_18FT_MM = 5486;

/** Deterministic PRNG so every seed run produces the same plant. */
export function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Epoch ms of 00:00 Asia/Kolkata, `daysAgo` days before the IST day containing `now`. */
export function istMidnight(now: number, daysAgo: number) {
  const istDayStart = Math.floor((now + IST_OFFSET_MS) / DAY_MS) * DAY_MS;
  return istDayStart - daysAgo * DAY_MS - IST_OFFSET_MS;
}

/** `YYYY-MM-DD` of the IST calendar day `daysAgo` days before `now` (negative = ahead). */
export function istDay(now: number, daysAgo: number): string {
  return new Date(now + IST_OFFSET_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
}

export function insertChunks<T extends SQLiteTable>(db: Db, table: T, rows: T["$inferInsert"][]): Statement[] {
  if (rows.length === 0) return [];
  const columns = Object.keys(getTableColumns(table)).length;
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / columns));
  const out: Statement[] = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    out.push(db.insert(table).values(rows.slice(i, i + perStatement)) as unknown as Statement);
  }
  return out;
}

export function pick<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) throw new Error(`dev-seed: missing ${label} at ${index}`);
  return item;
}

export function devLocationId(code: string) {
  return `dev-loc-${code}`;
}

export type SeedClock = {
  now: number;
  /** IST midnight of today. */
  todayStart: number;
  /** `fraction` (0..1) of the way from 06:00 IST today (or midnight before 07:00) to now. */
  todayAt(fraction: number): number;
  /** An instant `hour` (fractional) IST on the calendar day `daysAgo` days back. */
  pastAt(daysAgo: number, hour: number): number;
  /** The current production day: starts at shift 1's start (08:00 IST in the demo), ends 24 h later. */
  day: { startMs: number; endMs: number; productionDay: string };
  /** `fraction` (0..1) of the way from the production day's start to now: always inside the day. */
  dayAt(fraction: number): number;
};

export function seedClock(now: number, settings: Record<string, unknown>): SeedClock {
  const todayStart = istMidnight(now, 0);
  const todayWindowStart = now - todayStart > 7 * HOUR_MS ? todayStart + 6 * HOUR_MS : todayStart;
  const elapsedToday = Math.max(now - todayWindowStart, 1000);
  const window = productionDayWindow(settings, now);
  const dayElapsed = Math.max(now - window.startMs, 1000);
  return {
    now,
    todayStart,
    todayAt: (fraction) => todayWindowStart + Math.floor(elapsedToday * fraction),
    pastAt: (daysAgo, hour) => istMidnight(now, daysAgo) + Math.round(hour * HOUR_MS),
    day: { startMs: window.startMs, endMs: window.endMs, productionDay: window.productionDay },
    dayAt: (fraction) => window.startMs + Math.floor(dayElapsed * fraction),
  };
}

/** One bundle as the seed builds it in memory, before it is written (status history included). */
export type SeedBundle = {
  id: string;
  sessionIdx: number;
  serial: string;
  dieKey: string;
  quantity: number;
  weightG: number;
  createdAt: number;
  status: BundleStatus;
  currentDispatchId: string | null;
  serverSeq: number;
  /** Chronological status history after receipt. */
  events: { from: BundleStatus; to: BundleStatus; reason: string; at: number; dispatchId: string | null }[];
};

