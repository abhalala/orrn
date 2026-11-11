import { formatterFor, ORRN_DEFAULT_PREFS, type Fmt, type ResolvedPrefs } from "@orrn/domain";

/** Today's paper on a plant that wrote its lengths in feet and inches (company length unit "inch"): the default set with that one choice. */
const INCH_PAPER_PREFS: ResolvedPrefs = Object.freeze({
  ...ORRN_DEFAULT_PREFS,
  units: Object.freeze({ ...ORRN_DEFAULT_PREFS.units, length: "ft_in" }) as ResolvedPrefs["units"],
}) as ResolvedPrefs;

/**
 * The formatter for a text that mirrors a paper (the packing list, the stickers, the die card, the certificates) or has
 * no plant to ask (a model function called without one): today's units and words (kg, kg/12ft, Indian grouping), day
 * month year and the 24 hour clock, whatever the plant chose for its screens. A length is today's too: mm, or feet and
 * inches on a plant whose company length unit is "inch" (`inch: true`). Screens use `usePaperFmt()`.
 */
export function paperFormatter(locale: string | undefined | null, timeZone = "Asia/Kolkata", opts: { inch?: boolean } = {}): Fmt {
  return formatterFor(opts.inch ? INCH_PAPER_PREFS : ORRN_DEFAULT_PREFS, { locale: locale === "hi" || locale === "gu" ? locale : "en", timeZone });
}
