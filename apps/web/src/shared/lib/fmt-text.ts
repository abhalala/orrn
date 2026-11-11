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
import type { Translate } from "@orrn/i18n";

import { dateTimeJoiner, isValidZone, yearInZone as yearIn } from "./plant-calendar";

/** `formatKg(kg)`: two decimals, Indian grouping (the old band wording). */
const TWO_DECIMALS = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
/** Rupees as a bare grouped amount, two decimals ("3,00,000.00"): the reports' `rupeeText`. */
export const rupeeScreen = (fmt: Fmt, paise: number): string => fmt.n("order.amount", paise);
export const rupeeText = (fmt: Fmt, paise: number): string => fmt.money(paise, "export");

/**
 * One end of a die's weight band (grams per 12 ft): "2.40" in kg/12ft at two decimals as the stock and die screens
 * print it, three decimals in kg/m or lb/ft (those have no older wording to keep).
 */
export const bandEndText = (fmt: Fmt, gramsPer12ft: number): string =>
  fmt.unitOf("linear_mass").id === "kg_12ft" ? TWO_DECIMALS.format(gramsPer12ft / 1000) : fmt.n(BAND, gramsPer12ft, "screen");

/**
 * A cut length in a column whose header names no unit (the ageing report): a plant on mm reads the bare number it always did
 * ("3658"); a plant on feet and inches or metres reads the length with its unit ("12 ft", "3.658 m").
 */
export const cutLengthText = (fmt: Fmt, mm: number): string =>
  fmt.unitOf("length").id === "mm" ? fmt.n("bundle.length", mm) : fmt.q("bundle.length", mm);
/** True for a plant that chose metres: the mm-layout length boxes then take metres, so their hints say so. */
export const lengthIsMetres = (fmt: Fmt): boolean => fmt.unitOf("length").id === "m";
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

/**
 * "3 Oct, 14:20", or "31 Dec 2025, 11:30" outside the current year (the stock, purchase and store "when"):
 * the plant's date order and clock, in the plant's zone. `now` is only for tests.
 */
export function whenText(fmt: Fmt, at: string | number | Date, now: number = Date.now()): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  const sameYear = yearIn(ms, fmt.zone) === yearIn(now, fmt.zone);
  return `${fmt.date(ms, { year: !sameYear })}, ${fmt.time(ms)}`;
}

/** "24 Oct at 20:00" (the joiner is the language's own): a day and the time, no year (orders timelines). */
export function dayTimeText(fmt: Fmt, at: string | number | Date): string {
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime();
  if (!Number.isFinite(ms)) return "";
  return `${fmt.date(ms, { year: false })}${dateTimeJoiner(fmt.locale)}${fmt.time(ms)}`;
}

const msOf = (at: string | number | Date): number => (at instanceof Date ? at.getTime() : typeof at === "number" ? at : new Date(at).getTime());

/**
 * The plant's style on a fixed clock or in a fixed language: for the few screens that read their own zone
 * (the die room reads IST) or have always written English month names. An unknown zone keeps the plant's own.
 */
export function pinned(fmt: Fmt, env: { zone?: string | null; locale?: Fmt["locale"] }): Fmt {
  const zone = env.zone && isValidZone(env.zone) ? env.zone : undefined;
  return fmt.in({ ...(zone ? { timeZone: zone } : {}), ...(env.locale ? { locale: env.locale } : {}) });
}

/** "24 Oct 2026": the calendar day of an instant on the plant clock, always with the year. Empty for a date that is not one. */
export function dateText(fmt: Fmt, at: string | number | Date | null | undefined): string {
  if (at === null || at === undefined || at === "") return "";
  const ms = msOf(at);
  return Number.isFinite(ms) ? fmt.date(ms) : "";
}

/** "14:05" or "2:05 pm": the time of an instant on the plant clock. Empty for a time that is not one. */
export function clockText(fmt: Fmt, at: string | number | Date | null | undefined): string {
  if (at === null || at === undefined || at === "") return "";
  const ms = msOf(at);
  return Number.isFinite(ms) ? fmt.time(ms) : "";
}

/** "24 Oct 21:00": day and time with a plain space, no year (the approvals' facts). */
export function dayClockText(fmt: Fmt, at: string | number | Date): string {
  const ms = msOf(at);
  return `${fmt.date(ms, { year: false })} ${fmt.time(ms)}`;
}

/** "24 Oct 21:00 to 23:00", or both days when the stretch crosses midnight (the late-entry request). */
export function windowText(fmt: Fmt, startedAt: number, stoppedAt: number): string {
  const a = fmt.date(startedAt, { year: false });
  const b = fmt.date(stoppedAt, { year: false });
  return `${a} ${fmt.time(startedAt)} to ${a === b ? "" : `${b} `}${fmt.time(stoppedAt)}`;
}

/** "3 Oct 2026": a `YYYY-MM-DD` book date. Anything else comes back as given. */
export function bookDateText(fmt: Fmt, ymd: string): string {
  const t = fmt.day(ymd);
  return t === "-" ? ymd : t;
}

/** A book date for lists: "4 Oct" inside the year of `today`, "30 Dec 2025" outside it. */
export function bookDayText(fmt: Fmt, ymd: string, today: string): string {
  const t = fmt.day(ymd, { year: ymd.slice(0, 4) !== today.slice(0, 4) });
  return t === "-" ? ymd : t;
}

/**
 * "3 Oct at 14:00" (English), "3 अक्तू, 14:00" (Hindi): an instant on the plant clock with the year only outside the
 * plant's current year (purchase, approvals). `now` is only for tests.
 */
export function instantText(fmt: Fmt, at: string | number | Date, now: number = Date.now()): string {
  const ms = msOf(at);
  const sameYear = yearIn(ms, fmt.zone) === yearIn(now, fmt.zone);
  return `${fmt.date(ms, { year: !sameYear })}${fmt.locale === "hi" ? ", " : " at "}${fmt.time(ms)}`;
}

/** "4 Oct", or "30 Dec 2025" outside the plant's current year: an instant's calendar day on the plant clock. Empty when not a date. */
export function dayOrYearText(fmt: Fmt, at: string | number | Date | null | undefined, now: number = Date.now()): string {
  if (at === null || at === undefined || at === "") return "";
  const ms = msOf(at);
  if (!Number.isFinite(ms)) return "";
  return fmt.date(ms, { year: yearIn(ms, fmt.zone) !== yearIn(now, fmt.zone) });
}

/** A ship day from the server's `shipDay.ymd`: "4 Oct", with the year outside the current year (UTC, as it always was). */
export function shipDayText(fmt: Fmt, ymd: string | null | undefined, now: Date = new Date()): string | null {
  if (!ymd) return null;
  const t = fmt.day(ymd, { year: ymd.slice(0, 4) !== String(now.getUTCFullYear()) });
  return t === "-" ? null : t;
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


/** "5.900\u20136.200 kg/12ft": a die's weight band in the plant's section weight unit, the ends to three decimals. */
export const bandText = (fmt: Fmt, minG: number, maxG: number): string => `${sectionText(fmt, minG)}\u2013${sectionText(fmt, maxG)} ${sectionUnit(fmt)}`;

/** Chart labels for values plotted in kg: the same weight in the plant's unit, "12.5 lb"; `zeroPlain` writes an empty bucket as "0 lb". */
export const kgChartText = (fmt: Fmt, kg: number, zeroPlain = false): string =>
  zeroPlain && kg === 0 ? `0 ${massUnit(fmt)}` : `${kgGrouped1(fmt, Math.round(kg * 1000))} ${massUnit(fmt)}`;

/** A section weight, plain, zeros dropped ("2.4"): the die list's range column, `kgText` of a die's band end in kg/12ft. */
export const sectionPlainTrim = (fmt: Fmt, gramsPer12ft: number): string => fmt.n(BAND, gramsPer12ft, "export", { trim: true });

/** Aliases for screens that already import another `dayText` or `dayTimeText` (orders/format, foundry/format). */
export const dayTimeAt = dayTimeText;
export const dayOf = dayText;

/**
 * A `t` for a screen that mirrors a paper (the packing list): the unit words are the paper's (kg, kg per 12 ft, mm),
 * whatever the plant shows on its other screens.
 */
export const paperT = (t: Translate): Translate => (key, vars) => t(key, { massUnit: "kg", sectionUnit: "kg/12ft", lengthUnit: "mm", ...vars });

/**
 * Wall thickness from tenths of a mm, with its unit word ("1.2 mm"). A die wall is a small dimension that every plant,
 * feet and inches and metres ones too, has always read in mm, so it is "1.2 mm" whatever the plant's length unit.
 */
export const wallWithUnit = (_fmt: Fmt, tenthMm: number, withUnit = true): string => `${(tenthMm / 10).toFixed(1)}${withUnit ? " mm" : ""}`;
/** A die width, thickness or leg as the die screens write it: mm on a plant that reads mm or metres, inches on feet and inches. */
export const geometryWithUnit = (fmt: Fmt, mm: number): string => (fmt.unitOf("length").id === "m" ? `${Math.round(mm * 10) / 10} mm` : fmt.geometry(mm));
/** The second section weight beside the first (kg per metre beside kg per 12 ft). */
export const altSectionText = (fmt: Fmt, gramsPer12ft: number): string => fmt.altSection(gramsPer12ft);
/** Whole units of weight, grouped: `kgWholeText` under the default set. */
export const kgGrouped0 = (fmt: Fmt, grams: number): string => fmt.wholeMass(grams);
/** A billet diameter (or any short measure in mm that every plant has always read in mm): "152 mm" whatever the plant's length unit. */
export const diameterText = (_fmt: Fmt, mm: number, mmWord: string): string => `${mm} ${mmWord}`;
/** The words for a label that names the diameter's unit: always "mm", the box takes mm on every plant. */
export const diameterVars = (_fmt: Fmt): { lengthUnit: string } => ({ lengthUnit: "mm" });
