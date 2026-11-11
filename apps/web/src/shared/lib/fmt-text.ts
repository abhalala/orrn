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
import type { Fmt } from "@orrn/domain";

const MASS = "order.weight";
const BAND = "die.band";

export const kgGrouped3 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "screen");
export const kgGrouped1 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "total");
export const kgGrouped2 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "print");
export const kgPlain3 = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "export");
export const kgTrim = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "screen", { trim: true });
export const kgPlainTrim = (fmt: Fmt, grams: number): string => fmt.n(MASS, grams, "export", { trim: true });
export const sectionText = (fmt: Fmt, gramsPer12ft: number): string => fmt.n(BAND, gramsPer12ft, "export");
export const rateText = (fmt: Fmt, paisePerKg: number): string => fmt.n("order.rate", paisePerKg, "export");
export const countText = (fmt: Fmt, n: number): string => fmt.n("bundle.pieces", n);
export const rupeeText = (fmt: Fmt, paise: number): string => fmt.money(paise, "export");

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
