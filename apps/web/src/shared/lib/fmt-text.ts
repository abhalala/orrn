/**
 * Text helpers over the plant's `Fmt`, one for each shape the screens wrote by hand before the units layer
 * (units layer, slice b). Each one reproduces its old helper character for character under the default set
 * (`fmt-text.test.ts` runs both over thousands of values); with another set it follows the plant's unit and style.
 * Values are canonical: grams, grams per 12 ft, paise per kg, mm, whole pieces. No arithmetic here.
 *
 * Which helper replaces which:
 *   kgGrouped3  orderKgText, reports/portal kgText, moveKgText      "1,280.000 kg" without the unit
 *   kgGrouped1  listKgText, formatKgTotal(gToKg(g))                 one decimal, grouped
 *   kgGrouped2  formatKg(gToKg(g))                                  two decimals, grouped
 *   kgPlain3    kgFieldText, die and band text                      three decimals, no grouping
 *   kgTrim      purchase kgText, kgGroupedText                      grouped, zeros dropped
 *   kgPlainTrim die-model kgText                                    no grouping, zeros dropped
 *   sectionText milliText, milliKgText, kgPerMetreText of a band    section weight, three decimals, plain
 *   rateText    rateText                                            rupees per kg, two decimals, plain
 *   countText   pcsText, countText                                  whole pieces, grouped
 */
import { formatKg, formatStorage, gToKg, kgPerMetre, type Fmt } from "@orrn/domain";

const MASS = "order.weight";
const BAND = "die.band";

export const kgGrouped3 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "screen");
export const kgGrouped1 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "total");
export const kgGrouped2 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "print");
export const kgPlain3 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "export");
export const kgTrim = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "screen", { trim: true });
export const kgPlainTrim = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "export", { trim: true });
export const sectionText = (fmt: Fmt, gramsPer12ft: number): string => fmt.n(BAND, gramsPer12ft, "export");
/** `kg12Text`: grams per 12 ft as the section-weight text, or null without one. */
export const sectionOrNull = (fmt: Fmt, gramsPer12ft: number | null | undefined): string | null =>
  gramsPer12ft == null ? null : sectionText(fmt, gramsPer12ft);
export const rateText = (fmt: Fmt, paisePerKg: number): string => fmt.n("order.rate", paisePerKg, "export");
export const countText = (fmt: Fmt, n: number): string => fmt.n("bundle.pieces", n);
export const rupeeText = (fmt: Fmt, paise: number): string => fmt.money(paise, "export");

/**
 * One end of a die's weight band (grams per 12 ft): "2.40" in kg/12ft at two decimals as the stock and die screens
 * print it, three decimals in kg/m or lb/ft (those have no older wording to keep).
 */
export const bandEndText = (fmt: Fmt, gramsPer12ft: number): string =>
  fmt.unitOf("linear_mass").id === "kg_12ft" ? formatKg(gToKg(gramsPer12ft)) : fmt.n(BAND, gramsPer12ft, "screen");

/** The unit symbol for a column header or a suffix: "kg", "lb", "t". */
export const massUnit = (fmt: Fmt): string => fmt.unitOf("mass").symbol;
/** "kg/12ft", "kg/m", "lb/ft". */
export const sectionUnit = (fmt: Fmt): string => fmt.unitOf("linear_mass").symbol;
/** "mm", "m", or "ft in" for a plant on feet and inches. */
export const lengthUnitText = (fmt: Fmt): string => {
  const u = fmt.unitOf("length");
  return u.composite ? "ft in" : u.symbol;
};

/** A weight with its unit, for a value that stands alone: "1,280.000 kg". Three decimals in kg, two in lb. */
export const kgWithUnit = (fmt: Fmt, grams: number): string => fmt.q(MASS, grams, "screen");

const yearCache = new Map<string, Intl.DateTimeFormat>();
function yearIn(zone: string, at: number): string {
  let f = yearCache.get(zone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en", { year: "numeric", timeZone: zone });
    } catch {
      f = new Intl.DateTimeFormat("en", { year: "numeric" });
    }
    yearCache.set(zone, f);
  }
  return f.format(at);
}

/**
 * "3 Oct, 14:20", or "31 Dec 2025, 11:30" outside the current year (the stock, purchase and store "when"):
 * the plant's date order and clock, in the plant's zone. `now` is only for tests.
 */
export function whenText(fmt: Fmt, at: string | number | Date, now: number = Date.now()): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const sameYear = yearIn(fmt.zone, ms) === yearIn(fmt.zone, now);
  return `${fmt.date(ms, { year: !sameYear })}, ${fmt.time(ms)}`;
}

const joinerCache = new Map<string, string>();
/**
 * The words the language puts between a day and a time ("24 Oct at 20:00" in English on current browsers, a comma
 * on others). The orders timeline took this from `Intl` itself, so it is read from `Intl` here: a plant that
 * changed nothing sees the same joiner as before, whatever the browser's ICU says.
 */
function dateTimeJoiner(locale: Fmt["locale"]): string {
  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  let joiner = joinerCache.get(tag);
  if (joiner === undefined) {
    const parts = new Intl.DateTimeFormat(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, numberingSystem: "latn", timeZone: "UTC" }).formatToParts(0);
    const i = parts.findIndex((p) => p.type === "month");
    const next = parts[i + 1];
    joiner = next && next.type === "literal" ? next.value : ", ";
    joinerCache.set(tag, joiner);
  }
  return joiner;
}

/** "24 Oct at 20:00" (the joiner is the language's own): a day and the time, no year (orders timelines). */
export function dayTimeText(fmt: Fmt, at: string | number | Date): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  return `${fmt.date(ms, { year: false })}${dateTimeJoiner(fmt.locale)}${fmt.time(ms)}`;
}

/** "25 Oct": a calendar day with no year and no zone shift. */
export function dayText(fmt: Fmt, ymd: string): string {
  const t = fmt.day(ymd, { year: false });
  return t === "-" ? ymd : t;
}

/**
 * A cast-house length (billet, log): feet for a plant on mm or on feet and inches, as the foundry always wrote them
 * ("12.5 ft"); the plant's own unit for a plant that chose metres. Same text as `mmToFtText` plus " ft" for a default plant.
 */
export function castLengthText(fmt: Fmt, mm: number | null | undefined): string {
  if (mm === null || mm === undefined) return "";
  if (fmt.unitOf("length").id === "m") return fmt.q("bundle.length", mm);
  return `${Math.round((mm / 304.8) * 100) / 100} ft`;
}

const PLAIN = { grouping: "none", decimal: ".", group: "," } as const;

/**
 * Wall thickness from tenths of a mm, as the die screens write it: one decimal in mm ("1.2"), decimal inches in
 * three places on a feet and inches plant, four places in metres. With the unit word: "1.2 mm".
 */
export function wallWithUnit(fmt: Fmt, tenthMm: number, withUnit = true): string {
  const u = fmt.unitOf("length");
  if (u.composite) return formatStorage(tenthMm, "tenth_mm", "in", 3, PLAIN, { trim: true }) + (withUnit ? " in" : "");
  if (u.id === "m") return formatStorage(tenthMm, "tenth_mm", "m", 4, PLAIN, { trim: true }) + (withUnit ? " m" : "");
  return formatStorage(tenthMm, "tenth_mm", "mm", 1, PLAIN) + (withUnit ? " mm" : "");
}

/** A die width, thickness or leg (mm, may carry a tenth) as the die screens write it: "12.5 mm", decimal inches, or metres. */
export function geometryWithUnit(fmt: Fmt, mm: number): string {
  const u = fmt.unitOf("length");
  if (u.composite) return `${formatStorage(mm, "mm", "in", 3, PLAIN, { trim: true })} in`;
  if (u.id === "m") return `${formatStorage(mm, "mm", "m", 4, PLAIN, { trim: true })} m`;
  return `${formatStorage(mm, "mm", "mm", 1, PLAIN, { trim: true })} mm`;
}

/** "5.900\u20136.200 kg/12ft": a die's weight band in the plant's section weight unit, the ends to three decimals. */
export const bandText = (fmt: Fmt, minG: number, maxG: number): string => `${sectionText(fmt, minG)}\u2013${sectionText(fmt, maxG)} ${sectionUnit(fmt)}`;

/**
 * The second section weight beside the first: kg per metre when the plant reads kg/12ft (today's pair), kg/12ft when
 * it reads kg/m or lb/ft. From the stored grams per 12 ft, exact.
 */
export function altSectionText(fmt: Fmt, gramsPer12ft: number): string {
  if (fmt.unitOf("linear_mass").id === "kg_12ft") return `${kgPerMetre(gramsPer12ft).toFixed(3)} kg/m`;
  return `${(gramsPer12ft / 1000).toFixed(3)} kg/12ft`;
}
