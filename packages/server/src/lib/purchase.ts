/**
 * Scrap purchase helpers (spec P14): name keys for vendor/alias lookup, the D/C tolerance rule,
 * the ledger item reference for scrap, and the default scrap masters.
 */
import { DEFAULT_TIMEZONE, isValidTimezone, zonedYmd } from "./dayWindow";

/** D/C tolerance when `settings.dcTolerancePct` is not set: 50 bp = 0.5 % of the party weight. */
export const DEFAULT_DC_TOLERANCE_BP = 50;

/**
 * Lookup key of a vendor name, alias or scrap item: letters and digits only, lower case, any
 * script ("K.D. METALS" → "kdmetals", "KD Metal" → "kdmetal"). Different spellings that are not
 * the same key are tied together with aliases (or a merge), never guessed.
 */
export function nameKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** The company's D/C tolerance in basis points (falls back to the default for missing/bad values). */
export function dcToleranceBp(settings: Record<string, unknown> | null | undefined): number {
  const raw = settings?.dcTolerancePct;
  return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 && raw <= 10_000 ? raw : DEFAULT_DC_TOLERANCE_BP;
}

/** Grams the FC kanta may fall short of the party kanta without a note (floor, never rounded up). */
export function toleranceG(partyKgG: number, toleranceBp: number): number {
  return Math.floor((partyKgG * toleranceBp) / 10_000);
}

/**
 * The lot is short beyond tolerance: party − FC > party × bp / 10 000. Integer arithmetic, the
 * same comparison the OK statement makes in SQL. An unweighed lot (FC NULL) is not "short" here;
 * OK refuses it separately.
 */
export function isShortBeyondTolerance(partyKgG: number, fcKgG: number | null, toleranceBp: number): boolean {
  if (fcKgG === null) return false;
  return (partyKgG - fcKgG) * 10_000 > partyKgG * toleranceBp;
}

/**
 * `stock_ledger.item_ref` of scrap: one stock line per (scrap item, grade). The lot itself is the
 * posting's voucher (`purchase_lot` / lot id), so draws can later be traced per lot too.
 */
export function scrapItemRef(scrapItemId: string, scrapGradeId: string): string {
  return `${scrapItemId}:${scrapGradeId}`;
}

export function parseScrapItemRef(ref: string): { scrapItemId: string; scrapGradeId: string } | null {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { scrapItemId: ref.slice(0, at), scrapGradeId: ref.slice(at + 1) };
}

/** Today's date `YYYY-MM-DD` on the company wall clock. */
export function companyToday(settings: Record<string, unknown> | null | undefined, at: Date): string {
  const tz = typeof settings?.timezone === "string" && isValidTimezone(settings.timezone) ? settings.timezone : DEFAULT_TIMEZONE;
  const { year, month, day } = zonedYmd(tz, at.getTime());
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** A real calendar date `YYYY-MM-DD`. */
export function isIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

/** The instant used to pick a book date's document series period (midday UTC stays on that date). */
export function bookDateInstant(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** Grade ladder of the purchase book (digest §8.1). */
export const DEFAULT_SCRAP_GRADES: readonly { code: string; name: string }[] = [
  { code: "A+", name: "A plus" },
  { code: "A", name: "A" },
  { code: "B", name: "B" },
  { code: "C", name: "C" },
];

/** "Quality" column of the plant's purchase book. */
export const DEFAULT_SCRAP_ITEMS: readonly string[] = [
  "IMP BELLING",
  "SOFT CABLE",
  "KAGAL PATTI",
  "CENTRING",
  "ANGLE",
  "TT",
  "PATTA/ROTTER/HEATSINK",
  "TRANS PATRA",
];

/** GSTIN shape: 2-digit state, PAN (5 letters, 4 digits, letter), entity, Z, checksum. */
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
