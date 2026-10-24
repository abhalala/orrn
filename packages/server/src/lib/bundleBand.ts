/**
 * The ONE band rule (D15, wave-0 H1): a bundle's band is its die copy's band when the bundle names a
 * copy (a copy with no `band_id` is on the section's primary band), else the section's primary band
 * (`die.weight_min_g/max_g`). The raw kg per 12 ft is judged against that band: `position`
 * (below/in/above, by grams) and the drift `tone` from @orrn/domain `driftTone` with the plant's
 * drift settings. `bundle.previewLine`, `bundle.getBySerial` (`/b/$serial`), the pack session
 * (`bundle.getGroup`) and the stock views all call this helper, so one bundle gets one tone.
 */
import { and, eq, inArray } from "drizzle-orm";

import {
  bandPosition,
  driftPercentTenths,
  driftTone,
  readFloorSettings,
  type BandPosition,
  type DriftBands,
  type DriftTone,
} from "@orrn/domain";
import { die } from "@orrn/db/schema/catalog";
import { dieBand, dieInstance } from "@orrn/db/schema/dies";
import { company } from "@orrn/db/schema/tenant";

import { mapInChunks, type OrrnDb } from "./atomic";

export type BandSource = "copy" | "section";

export type BundleBand = {
  /** `die_band.id` of the copy's band; null on the section's primary band or with no band. */
  bandId: string | null;
  source: BandSource | null;
  minG: number | null;
  maxG: number | null;
  /** The band start (grams per 12 ft = kg/12 ft × 1000) drift is measured from. */
  bandStartMilli: number | null;
  position: BandPosition | null;
  tone: DriftTone;
  percentTenths: number | null;
};

export type BandSubject = { dieId: string; dieInstanceId?: string | null; kgPer12ftMilli: number | null };

type Band = { bandId: string | null; source: BandSource; minG: number; maxG: number };

/** A band only counts with a positive start and max ≥ min (an unset section band is 0/0). */
function usable(minG: number | null | undefined, maxG: number | null | undefined): boolean {
  return minG != null && maxG != null && minG > 0 && maxG >= minG;
}

/** Pure verdict: raw kg/12 ft against the chosen band. */
export function bandVerdict(latestMilli: number | null, band: Band | null, drift?: DriftBands | null): BundleBand {
  if (!band) {
    return { bandId: null, source: null, minG: null, maxG: null, bandStartMilli: null, position: null, tone: "none", percentTenths: null };
  }
  return {
    bandId: band.bandId,
    source: band.source,
    minG: band.minG,
    maxG: band.maxG,
    bandStartMilli: band.minG,
    position: bandPosition(latestMilli, band.minG, band.maxG),
    tone: driftTone({ latestMilli, bandStartMilli: band.minG, bands: drift ?? null }),
    percentTenths: latestMilli == null ? null : driftPercentTenths(latestMilli, band.minG),
  };
}

/** The plant's drift tone settings (`settings.drift`), read once per call. */
export async function plantDriftBands(db: OrrnDb, companyId: string): Promise<DriftBands> {
  const [co] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1);
  return readFloorSettings(co?.settings).drift;
}

/**
 * Band and tone for many bundles (or pack lines) at once; result i belongs to subject i.
 * A copy of another section is ignored (the section band applies).
 */
export async function bundleBandTones(
  db: OrrnDb,
  companyId: string,
  subjects: readonly BandSubject[],
  drift?: DriftBands,
): Promise<BundleBand[]> {
  if (subjects.length === 0) return [];
  const dieIds = [...new Set(subjects.map((s) => s.dieId))];
  const copyIds = [...new Set(subjects.flatMap((s) => (s.dieInstanceId ? [s.dieInstanceId] : [])))];
  const [sections, copies, bands] = await Promise.all([
    mapInChunks(dieIds, (ids) =>
      db
        .select({ id: die.id, minG: die.weightMinG, maxG: die.weightMaxG })
        .from(die)
        .where(and(eq(die.companyId, companyId), inArray(die.id, ids))),
    ),
    copyIds.length
      ? mapInChunks(copyIds, (ids) =>
          db
            .select({ id: dieInstance.id, sectionId: dieInstance.sectionId, bandId: dieInstance.bandId, minG: dieBand.weightMinG, maxG: dieBand.weightMaxG })
            .from(dieInstance)
            .leftJoin(dieBand, and(eq(dieBand.id, dieInstance.bandId), eq(dieBand.companyId, companyId)))
            .where(and(eq(dieInstance.companyId, companyId), inArray(dieInstance.id, ids))),
        )
      : Promise.resolve([]),
    drift ? Promise.resolve(drift) : plantDriftBands(db, companyId),
  ]);
  const sectionBand = new Map<string, Band | null>(
    sections.map((s) => [s.id, usable(s.minG, s.maxG) ? { bandId: null, source: "section" as const, minG: s.minG, maxG: s.maxG } : null]),
  );
  const copyById = new Map(copies.map((c) => [c.id, c]));
  return subjects.map((s) => {
    const primary = sectionBand.get(s.dieId) ?? null;
    let band = primary;
    const copy = s.dieInstanceId ? copyById.get(s.dieInstanceId) : undefined;
    if (copy && copy.sectionId === s.dieId) {
      band =
        copy.bandId && usable(copy.minG, copy.maxG)
          ? { bandId: copy.bandId, source: "copy", minG: copy.minG!, maxG: copy.maxG! }
          : primary;
    }
    return bandVerdict(s.kgPer12ftMilli, band, bands);
  });
}

/** One bundle or pack line: `bundleBandTones` for a single subject. */
export async function bundleBandTone(db: OrrnDb, companyId: string, subject: BandSubject): Promise<BundleBand> {
  return (await bundleBandTones(db, companyId, [subject]))[0]!;
}
