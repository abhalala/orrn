import { eq, sql, type SQL } from "drizzle-orm";

import { company } from "@orrn/db/schema/tenant";
import {
  MINUTES_PER_DAY,
  minuteText,
  readFloorSettings,
  resolveStandard,
  shiftLengthMin,
  type ProfileKind,
  type Shift,
  type ShiftError,
  type StandardPair,
  type Standards,
} from "@orrn/domain";

import type { OrrnDb } from "./atomic";

// ---------------------------------------------------------------------------
// Writing settings (council round 1, A3)
// ---------------------------------------------------------------------------

const SETTINGS_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

/**
 * The new `company.settings` value with only `patch`'s keys replaced, computed in SQL from the value
 * in the row when the statement runs (`json_set`), never from a copy read earlier. Every settings
 * write uses it, so two saves of different keys both land and a save never turns back a key it did
 * not name (the owner's "Require secure sign-in" above all). A key's own value is whatever the caller
 * computed (a nested object is replaced whole).
 *
 * A dotted key (`press.balanceWarnBp`, council round 2) replaces one key inside a nested object and
 * keeps its siblings as they are in the row; a parent that is missing or not an object becomes `{}`
 * first, so the inner key always lands.
 */
export function settingsPatchSql(patch: Record<string, unknown>): SQL {
  const pairs = Object.entries(patch).filter(([, v]) => v !== undefined);
  for (const [key] of pairs) {
    if (isLimitsKey(key)) throw new Error(`settings key ${key} is written only by orrn staff (platform.companiesSetLimits)`);
  }
  if (pairs.length === 0) return sql`coalesce(${company.settings}, '{}')`;
  const base = sql`coalesce(${company.settings}, '{}')`;
  const args: SQL[] = [];
  for (const [key, value] of pairs) {
    const parts = key.split(".");
    if (!parts.every((part) => SETTINGS_KEY.test(part))) throw new Error(`settings key ${key} is not a plain name`);
    for (let i = 1; i < parts.length; i++) {
      const parent = sql.raw(`'$.${parts.slice(0, i).join(".")}'`);
      args.push(sql`${parent}, json(CASE WHEN json_type(${base}, ${parent}) = 'object' THEN json_extract(${base}, ${parent}) ELSE '{}' END)`);
    }
    args.push(sql`${sql.raw(`'$.${key}'`)}, json(${JSON.stringify(value)})`);
  }
  return sql`json_set(${base}, ${sql.join(args, sql`, `)})`;
}


/** `limits` and `limits.*`: the plant's limits, which only orrn staff set (limits brief, section A). */
function isLimitsKey(key: string): boolean {
  return key === "limits" || key.startsWith("limits.");
}

/**
 * The new `company.settings` with only the named limits changed, computed in SQL from the row as it is
 * when the statement runs, like `settingsPatchSql`: a number sets the key, `null` removes it (the plant
 * reads the default again). Other limits and every other setting stay as they are, so two staff saving
 * different limits both land. Keys must already be checked against `PLANT_LIMIT_KEYS` (plain names).
 * Only `platform.companiesSetLimits` calls it.
 */
export function limitsPatchSql(change: Record<string, number | null>): SQL {
  const base = sql`coalesce(${company.settings}, '{}')`;
  const entries = Object.entries(change);
  for (const [key, value] of entries) {
    if (!SETTINGS_KEY.test(key)) throw new Error(`limit key ${key} is not a plain name`);
    if (value !== null && !Number.isSafeInteger(value)) throw new Error(`limit ${key} is not a whole number`);
  }
  const withParent = sql`json_set(${base}, '$.limits', json(CASE WHEN json_type(${base}, '$.limits') = 'object' THEN json_extract(${base}, '$.limits') ELSE '{}' END))`;
  const sets = entries.filter(([, v]) => v !== null);
  const removes = entries.filter(([, v]) => v === null);
  let out = withParent;
  if (sets.length > 0) {
    out = sql`json_set(${out}, ${sql.join(
      sets.map(([k, v]) => sql.raw(`'$.limits.${k}', ${v}`)),
      sql`, `,
    )})`;
  }
  if (removes.length > 0) {
    out = sql`json_remove(${out}, ${sql.join(
      removes.map(([k]) => sql.raw(`'$.limits.${k}'`)),
      sql`, `,
    )})`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Shifts (FP-PF-05)
// ---------------------------------------------------------------------------

/**
 * Minutes of the day no shift covers, as `HH:MM-HH:MM` ranges (empty when the shifts cover 24 h,
 * possibly with overlap). For the "gap" message the platform spec asks for (§6 Production day).
 */
export function shiftGapMinutes(shifts: readonly Pick<Shift, "startMin" | "endMin">[]): string[] {
  const covered = new Uint8Array(MINUTES_PER_DAY);
  for (const s of shifts) {
    const len = shiftLengthMin(s);
    for (let i = 0; i < len; i++) covered[(s.startMin + i) % MINUTES_PER_DAY] = 1;
  }
  const ranges: string[] = [];
  let i = 0;
  while (i < MINUTES_PER_DAY) {
    if (covered[i]) {
      i++;
      continue;
    }
    const from = i;
    while (i < MINUTES_PER_DAY && !covered[i]) i++;
    ranges.push(`${minuteText(from)}-${minuteText(i % MINUTES_PER_DAY)}`);
  }
  return ranges;
}

/** Plain message for the first shift rule broken (the screen maps the same rules to i18n keys). */
export function shiftErrorMessage(error: ShiftError, gaps: string[] | null): string {
  switch (error) {
    case "count":
      return "Keep one to four shifts";
    case "id":
      return "Each shift needs its own id";
    case "name_empty":
      return "Every shift needs a name";
    case "name_long":
      return "A shift name is at most 40 characters";
    case "name_duplicate":
      return "Two shifts have the same name";
    case "minute_range":
      return "Shift times run from 00:00 to 23:59";
    case "seq":
      return "Shift order must be 1, 2, 3, 4 with no number twice";
    case "zero_length":
      return "A shift cannot start and end at the same time";
    case "gap_or_overlap":
      return gaps && gaps.length > 0
        ? `The shifts leave ${gaps.join(", ")} uncovered`
        : "Two shifts overlap; together they must cover 24 hours once";
  }
}

// ---------------------------------------------------------------------------
// Standards (FP-PF-09)
// ---------------------------------------------------------------------------

/** What a label or certificate prints for one profile kind. Blank CM/L = no licence line. */
export type StandardLines = {
  /** BIS designation, e.g. `IS 733`, or null when nothing is set. */
  standard: string | null;
  /** CM/L licence number, or null: the label and certificate omit the licence line. */
  cml: string | null;
};

export function standardLines(pair: StandardPair | null): StandardLines {
  if (!pair) return { standard: null, cml: null };
  return { standard: pair.standard || null, cml: pair.cml || null };
}

/** The pair pack snapshots for a die's profile kind (null kind uses solid; semi falls back to solid). */
export function standardFor(standards: Standards, profileKind: ProfileKind | null | undefined): StandardLines {
  return standardLines(resolveStandard(standards, profileKind));
}

/** Stored pairs plus the resolved lines per kind, for pack and the certificate (`company.standards`). */
export async function companyStandards(db: OrrnDb, companyId: string) {
  const row = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).get();
  const standards = readFloorSettings(row?.settings ?? {}).standards;
  return {
    standards,
    resolved: {
      solid: standardFor(standards, "solid"),
      hollow: standardFor(standards, "hollow"),
      semi: standardFor(standards, "semi"),
      /** A die with no profile kind (legacy): solid's pair. */
      unknown: standardFor(standards, null),
    },
  };
}
