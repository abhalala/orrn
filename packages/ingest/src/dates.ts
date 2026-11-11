/**
 * Date parsing for the `date` step and for kind detection (plan B2, B8). Output is always ISO `YYYY-MM-DD` or null.
 * Separators - / . and space are accepted. A two-digit year at or below the current year + 1 means 20yy, else 19yy.
 */
import type { DateFormat } from "./recipe";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

export function monthFromName(name: string): number | null {
  return MONTHS[name.toLowerCase()] ?? null;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isoDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2200) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Four digits as they are; two digits by the rule in the file comment. */
export function expandYear(text: string, currentYear: number): number {
  if (text.length === 4) return Number(text);
  const yy = Number(text);
  const century = 2000 + yy <= currentYear + 1 ? 2000 : 1900;
  return century + yy;
}

export type DateOptions = { currentYear?: number };

const SEP = "[-/.\\s]";
const TIME = "(?:[T\\s]\\d{1,2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:Z|[+-]\\d{2}:?\\d{2})?)?";
const RE_NUM3 = new RegExp(`^(\\d{1,4})${SEP}+(\\d{1,2})${SEP}+(\\d{1,4})${TIME}$`);
const RE_DMON = new RegExp(`^(\\d{1,2})${SEP}*([A-Za-z]{3,9})\\.?${SEP}*,?\\s*(\\d{4}|\\d{2})${TIME}$`);
const RE_MONDY = new RegExp(`^([A-Za-z]{3,9})\\.?${SEP}*(\\d{1,2}),?${SEP}+(\\d{4})${TIME}$`);

/** Days from 1899-12-30 (Excel's day 0 for dates after 1900-03-01). */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2_958_465) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000;
  const d = new Date(ms);
  return isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

export function parseDate(text: string, format: DateFormat, opts: DateOptions = {}): string | null {
  const t = text.normalize("NFKC").trim();
  if (t === "") return null;
  const currentYear = opts.currentYear ?? new Date().getUTCFullYear();

  if (format === "excel_serial") {
    if (!/^\d+(?:\.\d+)?$/.test(t)) return null;
    return excelSerialToIso(Number(t));
  }
  if (format === "d_mon_y") {
    const m = RE_DMON.exec(t);
    if (m) {
      const month = monthFromName(m[2]!);
      return month === null ? null : isoDate(expandYear(m[3]!, currentYear), month, Number(m[1]));
    }
    const m2 = RE_MONDY.exec(t);
    if (m2) {
      const month = monthFromName(m2[1]!);
      return month === null ? null : isoDate(Number(m2[3]), month, Number(m2[2]));
    }
    return null;
  }
  const m = RE_NUM3.exec(t);
  if (!m) return null;
  const [a, b, c] = [m[1]!, m[2]!, m[3]!];
  // A year first with four digits is year-month-day in every format: it cannot be anything else.
  if (a.length === 4) return isoDate(Number(a), Number(b), Number(c));
  if (format === "ymd") {
    if (a.length === 4) return isoDate(Number(a), Number(b), Number(c));
    return null;
  }
  if (c.length !== 2 && c.length !== 4) return null;
  const year = expandYear(c, currentYear);
  return format === "dmy" ? isoDate(year, Number(b), Number(a)) : isoDate(year, Number(a), Number(b));
}

/** True when the text reads as a calendar date in any text format (never an Excel serial: it looks like a number). */
export function looksLikeDate(text: string, opts: DateOptions = {}): boolean {
  for (const f of ["ymd", "dmy", "mdy", "d_mon_y"] as const) if (parseDate(text, f, opts) !== null) return true;
  return false;
}

export type DateFormatGuess = {
  /** The one format every sample fits and that the others do not, else null. */
  format: DateFormat | null;
  /** More than one of dmy and mdy fits every sample: ask the person. */
  ambiguous: boolean;
  /** Formats under which every non-blank sample parsed. */
  candidates: DateFormat[];
};

/** Picks the date format of a column from its samples. Day-first and month-first both fitting is an ambiguity, not a guess. */
export function detectDateFormat(samples: readonly string[], opts: DateOptions = {}): DateFormatGuess {
  const cells = samples.map((s) => s.trim()).filter(Boolean);
  const candidates: DateFormat[] = [];
  if (cells.length === 0) return { format: null, ambiguous: false, candidates };
  for (const f of ["ymd", "dmy", "mdy", "d_mon_y", "excel_serial"] as const) {
    if (cells.every((c) => parseDate(c, f, opts) !== null)) candidates.push(f);
  }
  // ISO cells fit dmy and mdy as well (the year-first rule), so fold them into one answer.
  if (cells.every((c) => /^\d{4}\D/.test(c))) return { format: "ymd", ambiguous: false, candidates: ["ymd"] };
  const dayFirst = candidates.includes("dmy");
  const monthFirst = candidates.includes("mdy");
  if (dayFirst && monthFirst) {
    const same = cells.every((c) => parseDate(c, "dmy", opts) === parseDate(c, "mdy", opts));
    if (same) return { format: "dmy", ambiguous: false, candidates };
    return { format: null, ambiguous: true, candidates };
  }
  if (candidates.length === 1) return { format: candidates[0]!, ambiguous: false, candidates };
  if (candidates.includes("d_mon_y")) return { format: "d_mon_y", ambiguous: false, candidates };
  return { format: candidates[0] ?? null, ambiguous: false, candidates };
}
