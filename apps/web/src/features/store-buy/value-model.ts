/** The store value screen's logic, without React: months, the allowance percent, and the CSV. */
import { toCanonical } from "@orrn/domain";

/** 50 % (the server allows up to 5000 basis points). */
export const MAX_TOLERANCE_BP = 5_000;

const MONTH = /^(\d{4})-(\d{2})$/;

export function monthText(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** The last full month before `now`, as YYYY-MM (January gives the December before). */
export function defaultMonth(now: Date): string {
  const y = now.getFullYear();
  const m = now.getMonth() + 1;
  return m === 1 ? monthText(y - 1, 12) : monthText(y, m - 1);
}

/** `count` months ending at the last full month, newest first. */
export function monthChoices(now: Date, count = 24): string[] {
  const out: string[] = [];
  let [y, m] = defaultMonth(now).split("-").map(Number) as [number, number];
  for (let i = 0; i < count; i++) {
    out.push(monthText(y, m));
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  return out;
}

export function isMonth(text: string): boolean {
  const m = MONTH.exec(text);
  return Boolean(m && Number(m[2]) >= 1 && Number(m[2]) <= 12);
}

/** "2026-10" as year and month numbers. */
export function monthParts(text: string): { year: number; month: number } | null {
  const m = MONTH.exec(text);
  return m && isMonth(text) ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** Typed percent ("5", "2.5") to basis points; null when it is not a number from 0 to 50. */
export function toleranceBpFromText(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const r = toCanonical("customer.tolerance", trimmed, "pct", { mode: "round" });
  if (!r.ok || r.value < 0 || r.value > MAX_TOLERANCE_BP) return null;
  return r.value;
}

/** Basis points as a plain input value: 250 gives "2.5", 500 gives "5". */
export function toleranceText(bp: number): string {
  return String(bp / 100);
}

/** One CSV field: quoted when it holds a comma, quote or line break; a leading = + - @ is made safe for spreadsheets. */
/** A number the app formatted itself (e.g. "-12.500"): written as is, so a spreadsheet reads it as a number. */
export type CsvNumber = { readonly num: string };
export type CsvValue = string | number | CsvNumber;

export function csvCell(value: CsvValue): string {
  if (typeof value === "object") return value.num;
  let s = String(value);
  // Text from people (item names) that starts like a formula is neutralised; numbers never are.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvText(rows: CsvValue[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

type MonthRow = {
  name: string;
  unit: string;
  openingMilli: number;
  openingPaise: number;
  inMilli: number;
  inPaise: number;
  outMilli: number;
  outPaise: number;
  ratedPaise: number;
  closingMilli: number;
  closingPaise: number;
  closingUnratedMilli: number;
};

/** Plain decimals for a spreadsheet: quantity in the item's unit, money in rupees, both exact. */
function dec(n: number): CsvNumber {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return { num: `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, "0")}` };
}
function rs(paise: number): CsvNumber {
  const sign = paise < 0 ? "-" : "";
  const a = Math.abs(paise);
  return { num: `${sign}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}` };
}

/**
 * The month report as CSV text; `head` is the translated header row, `unitWord` the item's unit word.
 * Quantities are the store's own units (kg, litre, piece) as the server keeps them, so `unitWord` must
 * name those units, not the plant's display unit.
 */
export function monthCsv(
  head: string[],
  rows: MonthRow[],
  totals: { openingPaise: number; inPaise: number; outPaise: number; ratedPaise: number; closingPaise: number },
  totalLabel: string,
  unitWord: (unit: string) => string,
): string {
  const body: CsvValue[][] = rows.map((r) => [
    r.name,
    unitWord(r.unit),
    dec(r.openingMilli),
    rs(r.openingPaise),
    dec(r.inMilli),
    rs(r.inPaise),
    dec(r.outMilli),
    rs(r.outPaise),
    rs(r.ratedPaise),
    dec(r.closingMilli),
    rs(r.closingPaise),
    dec(r.closingUnratedMilli),
  ]);
  body.push([
    totalLabel, "", "", rs(totals.openingPaise), "", rs(totals.inPaise), "", rs(totals.outPaise),
    rs(totals.ratedPaise), "", rs(totals.closingPaise), "",
  ]);
  return csvText([head, ...body]);
}
