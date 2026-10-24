/** Trim, uppercase, and strip one layer of surrounding quotes (CSV/Excel paste, wedge scanners). */
export function normalizeSerial(raw: string): string {
  let s = raw.trim();
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      s = s.slice(1, -1).trim();
    }
  }
  return s.toUpperCase();
}

export type ScanResult = { kind: "serial"; serial: string } | { kind: "unknown"; raw: string };

const BARE_SERIAL = /^[A-Z0-9][A-Z0-9._-]*$/;
const URL_SERIAL_PATH = /\/b\/([^/]+)\/?$/i;

/** Accepts a bare serial or any URL whose path ends `/b/<serial>` (the QR on the bundle label). */
export function parseScan(raw: string): ScanResult {
  const text = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    try {
      const match = URL_SERIAL_PATH.exec(new URL(text).pathname);
      if (match?.[1]) {
        const serial = normalizeSerial(decodeURIComponent(match[1]));
        if (BARE_SERIAL.test(serial)) return { kind: "serial", serial };
      }
    } catch {
      // malformed URL or percent-encoding: fall through to unknown
    }
    return { kind: "unknown", raw };
  }
  const serial = normalizeSerial(text);
  return BARE_SERIAL.test(serial) ? { kind: "serial", serial } : { kind: "unknown", raw };
}

/** Newline / comma / space / tab separated serials, normalised and de-duplicated in first-seen order. */
export function splitPastedSerials(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,]+/)) {
    const serial = normalizeSerial(part);
    if (serial) seen.add(serial);
  }
  return [...seen];
}

// ---------------------------------------------------------------------------
// Plant document numbers (spec P7/P8, digest §3.7)
// ---------------------------------------------------------------------------

const MONTH_LETTERS = "ABCDEFGHIJKL";
/** Longest sequence the plant label has room for (digest §3.7: 1–5 digits). */
export const MAX_BUNDLE_SEQ = 99_999;

/** Month 1–12 to its plant letter: A = Jan … L = Dec (I = Sep on the sample label dated 13-09-26). */
export function monthLetter(month1to12: number): string {
  if (!Number.isInteger(month1to12) || month1to12 < 1 || month1to12 > 12) {
    throw new RangeError(`Month must be 1-12, got ${month1to12}`);
  }
  return MONTH_LETTERS[month1to12 - 1]!;
}

/** Plant letter (any case) to month 1–12, or null. */
export function monthFromLetter(letter: string): number | null {
  if (letter.length !== 1) return null;
  const idx = MONTH_LETTERS.indexOf(letter.toUpperCase());
  return idx === -1 ? null : idx + 1;
}

function assertSeq(seq: number) {
  if (!Number.isInteger(seq) || seq < 1 || seq > MAX_BUNDLE_SEQ) {
    throw new RangeError(`Sequence must be 1-${MAX_BUNDLE_SEQ}, got ${seq}`);
  }
}

/** `26I4086`: 2-digit year + month letter + monthly sequence (no padding). */
export function formatBundleNo(year: number, month: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2099) {
    throw new RangeError(`Year must be 2000-2099, got ${year}`);
  }
  assertSeq(seq);
  return `${String(year % 100).padStart(2, "0")}${monthLetter(month)}${seq}`;
}

/** Cast code as written on paper: month letter + monthly sequence, no year (`K31`). */
export function formatCastCode(month: number, seq: number): string {
  assertSeq(seq);
  return `${monthLetter(month)}${seq}`;
}

const CAST_CODE = /^([A-L])(\d{1,5})$/;

/**
 * Cast number parts from the doc series (memory: cast no = month letter + seq; the year is stored,
 * never printed). `period` is the series period `YYYY-MM`. `castNumberParts("2026-11", 31)` →
 * `{ year: 2026, month: 11, seq: 31, number: "K31" }`. The seq comes from `allocateDocNumbers`
 * (type `cast`), which starts the month at `castSeriesStart.start` when that month is the book's
 * go-live month (`castSeriesFirstSeq`).
 */
export function castNumberParts(period: string, seq: number): { year: number; month: number; seq: number; number: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) throw new RangeError(`Cast period must be YYYY-MM, got ${period}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return { year, month, seq, number: formatCastCode(month, seq) };
}

/** `K31` → `{ month: 11, seq: 31 }` (normalised: case and spaces); null when it is not a series code. */
export function parseCastCode(raw: string): { month: number; seq: number } | null {
  const m = CAST_CODE.exec(raw.trim().toUpperCase().replace(/\s+/g, ""));
  if (!m) return null;
  const seq = Number(m[2]);
  if (seq < 1) return null;
  return { month: monthFromLetter(m[1]!)!, seq };
}

/** A manual (legacy) cast code must not look like a series code (`^[A-L][0-9]+$`, spec §B doc series). */
export function isSeriesCastCode(raw: string): boolean {
  return parseCastCode(raw) !== null;
}

const PLANT_NO = /^(\d{2})([A-L])(\d{1,5})$/;
const OLD_NO = /^([A-L])(\d{1,5})$/;

/**
 * Parse `26I4086` (year 2000 + yy) or the old month-only `J540` (no year, caller must ask).
 * Input is normalised first, so lower case, quotes and padding are fine. Sequence 0 is rejected.
 */
export function parseBundleNo(raw: string): { year?: number; month: number; seq: number } | null {
  const s = normalizeSerial(raw);
  const full = PLANT_NO.exec(s);
  if (full) {
    const seq = Number(full[3]);
    if (seq < 1) return null;
    return { year: 2000 + Number(full[1]), month: monthFromLetter(full[2]!)!, seq };
  }
  const old = OLD_NO.exec(s);
  if (old) {
    const seq = Number(old[2]);
    if (seq < 1) return null;
    return { month: monthFromLetter(old[1]!)!, seq };
  }
  return null;
}

const CUID = /^[a-z][a-z0-9]{19,31}$/;

export type CodeKind =
  /** `26I4086` */
  | { kind: "plant"; serial: string; year: number; month: number; seq: number }
  /** `J540`: month letter + seq, year unknown */
  | { kind: "monthOnly"; serial: string; month: number; seq: number }
  /** 20-32 char legacy FCMS cuid (lower case) */
  | { kind: "cuid"; id: string }
  /** anything else that looks like a serial (`BG-000001-B001`) */
  | { kind: "serial"; serial: string }
  | { kind: "unknown"; raw: string };

/**
 * Classify what a scanner / typed entry / pasted QR URL holds. The QR on a label is
 * `https://{host}/b/{number}`; bare numbers, old numbers, legacy cuids and BG serials also arrive.
 * A string can be both a plausible serial and a cuid; callers try the exact serial first.
 */
export function classifyCode(raw: string): CodeKind {
  const scan = parseScan(raw);
  if (scan.kind === "unknown") return { kind: "unknown", raw };
  const { serial } = scan;
  const parsed = parseBundleNo(serial);
  if (parsed?.year !== undefined) return { kind: "plant", serial, year: parsed.year, month: parsed.month, seq: parsed.seq };
  if (parsed) return { kind: "monthOnly", serial, month: parsed.month, seq: parsed.seq };
  const id = serial.toLowerCase();
  if (CUID.test(id)) return { kind: "cuid", id };
  return { kind: "serial", serial };
}
