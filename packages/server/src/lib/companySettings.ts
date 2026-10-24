import { eq } from "drizzle-orm";

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
