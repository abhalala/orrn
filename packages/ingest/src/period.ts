/**
 * Period detection (plan B8). The financial year runs April to March; a label is "2025-26". Sources: file name, title
 * rows, sheet names, the min and max of a date column, plant bundle numbers, legacy code shapes. Two-digit years at or
 * below the current year + 1 mean 20yy, otherwise 19yy. A period the system cannot tell is asked, never guessed.
 *
 * `FY26` means the year that ends in 2026, so "2025-26" (the usual Indian reading).
 */
import { classifyCode, parseBundleNo } from "@orrn/domain";

import { daysInMonth, expandYear, isoDate, monthFromName } from "./dates";
import type { PeriodConfidence, PeriodGuess, Recipe } from "./recipe";

export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** FY label of a calendar month and year. */
export function fyOf(year: number, month: number): string {
  return fyLabel(month >= 4 ? year : year - 1);
}

export function fyOfIso(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? fyOf(Number(m[1]), Number(m[2])) : null;
}

type Found = { fys: Set<string>; asOf: string | null };

const FULL_NUMERIC = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/g;
const FULL_ISO = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const FULL_MON = /(?<![\dA-Za-z])(\d{1,2})[\s./-]*([A-Za-z]{3,9})[\s./,-]*(\d{4}|\d{2})(?!\d)/g;
const FY_RANGE = /(?<!\d)(20\d{2})\s*[-/]\s*(\d{4}|\d{2})(?!\d)/g;
const FY_SHORT = /\bFY\s*[-_]?\s*(\d{4}|\d{2})(?!\d)/gi;
const MON_YEAR = /(?<![A-Za-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*[\s._'-]*(\d{4}|\d{2})(?!\d)/gi;

function scanText(textIn: string, currentYear: number): Found {
  const fys = new Set<string>();
  let asOf: string | null = null;
  let text = textIn.normalize("NFKC");
  const takeDate = (iso: string | null) => {
    if (iso === null) return;
    const fy = fyOfIso(iso);
    if (fy) fys.add(fy);
    asOf ??= iso;
  };

  text = text.replace(FULL_ISO, (m, y: string, mo: string, d: string) => {
    const iso = isoDate(Number(y), Number(mo), Number(d));
    takeDate(iso);
    return iso ? " " : m;
  });
  text = text.replace(FULL_MON, (m, d: string, mon: string, y: string) => {
    const month = monthFromName(mon);
    const iso = month === null ? null : isoDate(expandYear(y, currentYear), month, Number(d));
    takeDate(iso);
    return iso ? " " : m;
  });
  text = text.replace(FULL_NUMERIC, (m, d: string, mo: string, y: string) => {
    const iso = isoDate(expandYear(y, currentYear), Number(mo), Number(d));
    takeDate(iso);
    return iso ? " " : m;
  });
  text = text.replace(FY_RANGE, (m, a: string, b: string) => {
    const start = Number(a);
    const end = b.length === 4 ? Number(b) : Math.floor(start / 100) * 100 + Number(b);
    if (end !== start + 1) return m;
    fys.add(fyLabel(start));
    return " ";
  });
  text = text.replace(FY_SHORT, (_m, y: string) => {
    const end = y.length === 4 ? Number(y) : expandYear(y, currentYear);
    fys.add(fyLabel(end - 1));
    return " ";
  });
  text.replace(MON_YEAR, (_m, mon: string, y: string) => {
    const month = monthFromName(mon);
    if (month !== null) fys.add(fyOf(expandYear(y, currentYear), month));
    return " ";
  });
  return { fys, asOf };
}

export type PeriodInput = {
  fileName?: string;
  sheetNames?: readonly string[];
  /** Title rows of the blocks. */
  titles?: readonly (string | null)[];
  /** Min and max ISO date of the date column after the recipe ran. */
  dateRange?: { min: string; max: string } | null;
  /** Bundle numbers in the block (`26I4086`). */
  bundleNos?: readonly string[];
  /** Codes that may be legacy ids (cuid or BG serials). */
  codes?: readonly string[];
  currentYear?: number;
};

function stripExtension(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, "");
}

export function detectPeriod(input: PeriodInput): PeriodGuess {
  const currentYear = input.currentYear ?? new Date().getUTCFullYear();
  const sources: PeriodGuess["sources"] = [];
  const entries: { kind: string; fys: Set<string> }[] = [];
  const asOfs: { kind: string; iso: string }[] = [];

  const add = (kind: string, value: string, found: Found) => {
    if (found.fys.size === 0 && found.asOf === null) return;
    sources.push({ kind, value: [...found.fys].join(" ") || (found.asOf ?? value) });
    if (found.fys.size > 0) entries.push({ kind, fys: found.fys });
    if (found.asOf !== null) asOfs.push({ kind, iso: found.asOf });
  };

  // Title first: "AS ON 31.10.2025" is the strongest statement of the as-of date.
  const titles = (input.titles ?? []).filter((t): t is string => !!t && t.trim() !== "");
  if (titles.length > 0) add("title", titles.join(" "), scanText(titles.join(" "), currentYear));
  if (input.fileName) add("file_name", input.fileName, scanText(stripExtension(input.fileName), currentYear));
  const sheets = (input.sheetNames ?? []).filter((s) => s.trim() !== "");
  if (sheets.length > 0) {
    const merged: Found = { fys: new Set(), asOf: null };
    for (const s of sheets) {
      const f = scanText(s, currentYear);
      f.fys.forEach((x) => merged.fys.add(x));
      merged.asOf ??= f.asOf;
    }
    add("sheet_name", sheets.join(", "), merged);
  }

  if (input.dateRange) {
    const fy = fyOfIso(input.dateRange.max);
    if (fy) {
      sources.push({ kind: "date_column", value: `${input.dateRange.min}..${input.dateRange.max}` });
      entries.push({ kind: "date_column", fys: new Set([fy]) });
    }
  }

  if (input.bundleNos && input.bundleNos.length > 0) {
    let best: string | null = null;
    for (const raw of input.bundleNos) {
      const p = parseBundleNo(raw);
      if (p?.year === undefined) continue;
      const fy = fyOf(p.year, p.month);
      if (best === null || fy > best) best = fy;
    }
    if (best) {
      sources.push({ kind: "bundle_no", value: best });
      entries.push({ kind: "bundle_no", fys: new Set([best]) });
    }
  }

  if (input.codes && input.codes.some((c) => {
    const k = classifyCode(c);
    return k.kind === "cuid" || (k.kind === "serial" && /^BG/i.test(k.serial));
  })) {
    sources.push({ kind: "legacy_code", value: "pre_cutover" });
  }

  const all = new Set<string>();
  for (const e of entries) e.fys.forEach((f) => all.add(f));
  const distinctAsOf = new Set(asOfs.map((a) => a.iso));
  const asOf = asOfs[0]?.iso ?? null;

  let confidence: PeriodConfidence;
  let fy: string | null = null;
  if (all.size === 0) {
    confidence = "unknown";
  } else {
    fy = [...entries[0]!.fys][0]!;
    if (all.size > 1 || distinctAsOf.size > 1) confidence = "low";
    else confidence = entries.length >= 2 ? "high" : "medium";
  }
  return { fy, asOf, confidence, sources };
}

/** Plan B8: required only for orders with no `orderDate` read from a column. The person confirms `fy` and `asOf`. */
export function periodRequired(recipe: Recipe): boolean {
  if (recipe.target !== "orders") return false;
  const f = recipe.fields.find((x) => x.field === "orderDate");
  return !f || f.source.kind === "period_as_of";
}

/** Days in the last month of an FY, for callers that build an as-of default. */
export function fyEnd(fy: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return null;
  const end = Number(m[1]) + 1;
  return isoDate(end, 3, daysInMonth(end, 3));
}
