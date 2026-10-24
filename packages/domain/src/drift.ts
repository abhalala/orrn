/**
 * Die drift and recovery arithmetic (FP-DR-04/05/06/15, FP-PR-11/17; ledger D8: the bands are
 * tenant settings, computed here, never on the client alone). Weights per 12 ft are integer
 * thousandths of a kg (= grams per 12 ft), the unit of `die.weight_min_g` and
 * `die_weight_reading.kg_per_12ft_milli`. Nothing here is stored.
 */

/** `settings.driftGreenMaxBp` default: latest within 8.00 % of the band start is green. */
export const DRIFT_GREEN_MAX_BP = 800;
/** `settings.driftAmberMaxBp` default: above green and within 10.00 % is amber; above is red. */
export const DRIFT_AMBER_MAX_BP = 1000;

export type DriftBands = { greenMaxBp: number; amberMaxBp: number };
export type DriftTone = "none" | "under" | "green" | "amber" | "red";
export type BandPosition = "in" | "above" | "below";

/** floor(num / den + 1/2) for integers with den > 0, exact (half rounds toward +infinity). */
function roundHalfUp(num: number, den: number): number {
  return Math.floor((2 * num + den) / (2 * den));
}

/**
 * Percent drift in tenths of a percent, rounded half up: `(latest - start) / start`.
 * 5.967 over a 5.900 start is 11 (+1.1 %); 6.480 is 98 (+9.8 %). Null without a band start.
 */
export function driftPercentTenths(latestMilli: number, bandStartMilli: number): number | null {
  if (!(bandStartMilli > 0)) return null;
  const diff = latestMilli - bandStartMilli;
  if (Number.isSafeInteger(diff * 1000)) return roundHalfUp(diff * 1000, bandStartMilli);
  return Math.floor((diff * 1000) / bandStartMilli + 0.5);
}

/** The same drift in basis points (1/100 of a percent), rounded half up. */
export function driftBp(latestMilli: number, bandStartMilli: number): number | null {
  if (!(bandStartMilli > 0)) return null;
  return roundHalfUp((latestMilli - bandStartMilli) * 10_000, bandStartMilli);
}

/** "+1.1%" / "-1.0%" from tenths of a percent. */
export function driftPercentText(tenths: number): string {
  const sign = tenths < 0 ? "-" : "+";
  return `${sign}${(Math.abs(tenths) / 10).toFixed(1)}%`;
}

/**
 * Colour of a copy's latest reading against its band start. The edges compare the exact ratio
 * (`(latest - start) x 10000 <= greenMaxBp x start`), so 8.00 % is green and 8.01 % amber.
 * `under` = lighter than the band start. `none` = no reading or no band.
 */
export function driftTone(input: {
  latestMilli: number | null | undefined;
  bandStartMilli: number | null | undefined;
  bands?: DriftBands | null;
}): DriftTone {
  const { latestMilli, bandStartMilli } = input;
  if (latestMilli == null || bandStartMilli == null || !(bandStartMilli > 0)) return "none";
  const bands = input.bands ?? { greenMaxBp: DRIFT_GREEN_MAX_BP, amberMaxBp: DRIFT_AMBER_MAX_BP };
  const diff = latestMilli - bandStartMilli;
  if (diff < 0) return "under";
  if (diff * 10_000 <= bands.greenMaxBp * bandStartMilli) return "green";
  if (diff * 10_000 <= bands.amberMaxBp * bandStartMilli) return "amber";
  return "red";
}

/** Where a reading sits against a band, by grams per 12 ft. Null without a reading. */
export function bandPosition(latestMilli: number | null | undefined, minG: number, maxG: number): BandPosition | null {
  if (latestMilli == null) return null;
  if (latestMilli < minG) return "below";
  if (latestMilli > maxG) return "above";
  return "in";
}

/** kg per metre from kg/12ft thousandths: `(milli / 1000) / (12 x 0.3048)`, 3 decimals. */
export function kgPerMetre(kgPer12ftMilli: number): number {
  // milli / 3657.6 kg per metre; x 1000 for 3 decimals = milli x 10000 / 36576.
  return Math.round((kgPer12ftMilli * 10_000) / 36_576) / 1000;
}

/**
 * Import of a kg/m catalogue (FP-DR-02 rule 4): kg per metre x 12 x 0.3048 = kg per 12 ft, stored
 * as grams per 12 ft, rounded to the nearest gram, before the band guard runs. 0.5 kg/m = 1,829 g.
 */
export function kgPerMetreToG12ft(kgPerMetre: number): number {
  // kg/m x 3.6576 m x 1000 g = kg/m x 3657.6; x10 then /10 keeps the arithmetic exact for 3 dp input.
  return Math.round((Math.round(kgPerMetre * 1000) * 36_576) / 10_000);
}

/** Tenant recovery bands (`settings.recoveryBands`); unset means the report shows no colour. */
export type RecoveryBands = { greenMinBp: number; amberMinBp: number };
export type RecoveryTone = "none" | "green" | "amber" | "red";

export function recoveryTone(recoveryBp: number | null | undefined, bands: RecoveryBands | null | undefined): RecoveryTone {
  if (recoveryBp == null || !bands) return "none";
  if (recoveryBp >= bands.greenMinBp) return "green";
  if (recoveryBp >= bands.amberMinBp) return "amber";
  return "red";
}

export type SuggestCopy = {
  id: string;
  seqNo: number;
  status: string;
  tierRank: number | null;
  latestMilli: number | null;
  /** The copy's effective band (its `die_band`, else the section's primary band). */
  bandMinG: number;
  bandMaxG: number;
};

/**
 * "Die room would issue 12170-1" (FP-DR-15, C36): among `available` copies only, in-band copies
 * first by lightest latest reading, then best tier (1 = best, unranked last), then copy number.
 * Copies with no reading or out of band come after every in-band copy. Ignores colour; never issues.
 */
export function suggestFirstCopy<T extends SuggestCopy>(copies: readonly T[]): T | null {
  const inf = Number.POSITIVE_INFINITY;
  const ranked = copies
    .filter((c) => c.status === "available")
    .map((c) => ({ c, inBand: bandPosition(c.latestMilli, c.bandMinG, c.bandMaxG) === "in" ? 0 : 1 }))
    .sort(
      (a, b) =>
        a.inBand - b.inBand ||
        (a.c.latestMilli ?? inf) - (b.c.latestMilli ?? inf) ||
        (a.c.tierRank ?? inf) - (b.c.tierRank ?? inf) ||
        a.c.seqNo - b.c.seqNo,
    );
  return ranked[0]?.c ?? null;
}
