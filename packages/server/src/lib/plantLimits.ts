/**
 * Per-plant limits that orrn staff set in Godseye (limits brief, section A).
 *
 * Stored in `company.settings.limits` as `{ key: number }`. A key that is missing means the default in
 * code. Written only by `platform.companiesSetLimits`; no tenant procedure may write it
 * (`settingsPatchSql` refuses the key). Read through `resolveLimits` (pure, here) or `effectiveLimits`
 * (`./effectiveLimits.ts`, reads the row), which merge the defaults and clamp to the hard ceilings, so a
 * bad stored value never lifts a limit past its ceiling.
 *
 * Pure on purpose: the Godseye screen imports it for the defaults and ceilings. No drizzle, no env.
 *
 * Hard ceilings (chosen 2026-11-20, write down any change in the build report):
 * - dayModelCalls 3,000: ten times the default; a 100-page dense scan at 4 bands and a retry each is 1,000.
 * - dayModelCostCents 5,000 (50 USD): ten times the default.
 * - blockModelCalls 10: the attempt ladder stops a block well before this.
 * - visionPagesPerBatch 80: one batch's tickets and reads stay a few minutes of work per click. The page
 *   listings follow the R2 cursor at 1,000 keys a call (contract section 12), so this ceiling no longer
 *   guards the listing; a file may have up to `VISION_FILE_MAX_PAGES` pages, read batch by batch.
 * - filesPerUpload 100: five times the default; the browser reads each file in turn.
 * - rawRowsPerFile 1,000,000: five times the default. Browser memory at this size is not measured yet;
 *   the per-block and blocks-per-file bounds (50,000 x 50) still apply.
 * - openRowsPerPlant 2,000,000: about seven times the default staged rows waiting in D1.
 * - uploadFileMiB 2,048 (2 GiB), default the same: the largest raw file. The whole-file SHA-256 check of a chunked
 *   upload runs in one request (`upload-parts.ts` `confirmWhole`); at the slowest rate measured on local workerd
 *   (550 MiB/s, 16 KiB chunks, machine under load) 2 GiB takes under 4 s against the 30 s CPU default, a margin of
 *   about 8x before any edge slowdown. Staff can only lower it. Fix round 2026-11-20, VISION-BUILD-REPORT.md.
 * - vaultQuotaGiB 1,024 (1 TiB), default 50: raw bytes the plant keeps in the vault, counted from D1 rows (stored
 *   files plus uploads begun in the last day), never from R2 listings.
 */
import { VISION_PARAMS } from "@orrn/ingest";

import { BLOCK_CALL_CAP, DAY_CALL_CAP, DAY_COST_CAP_MICRO, type CapValues } from "./ingest/bot/caps";
import { INGEST_LIMITS } from "./ingest/types";

/** Micro-USD in one US cent. The day cost cap is stored in cents and used in micro-USD. */
export const MICRO_PER_CENT = 10_000;

export const PLANT_LIMIT_KEYS = [
  "dayModelCalls",
  "dayModelCostCents",
  "blockModelCalls",
  "visionPagesPerBatch",
  "filesPerUpload",
  "rawRowsPerFile",
  "openRowsPerPlant",
  "uploadFileMiB",
  "vaultQuotaGiB",
] as const;
export type PlantLimitKey = (typeof PLANT_LIMIT_KEYS)[number];

export type PlantLimitDef = { default: number; ceiling: number };

export const PLANT_LIMITS: Readonly<Record<PlantLimitKey, PlantLimitDef>> = {
  dayModelCalls: { default: DAY_CALL_CAP, ceiling: 3_000 },
  dayModelCostCents: { default: DAY_COST_CAP_MICRO / MICRO_PER_CENT, ceiling: 5_000 },
  blockModelCalls: { default: BLOCK_CALL_CAP, ceiling: 10 },
  visionPagesPerBatch: { default: VISION_PARAMS.maxPagesPerFile, ceiling: 80 },
  filesPerUpload: { default: INGEST_LIMITS.filesPerUpload, ceiling: 100 },
  rawRowsPerFile: { default: INGEST_LIMITS.rawRowsPerFile, ceiling: 1_000_000 },
  openRowsPerPlant: { default: INGEST_LIMITS.openRowsPerPlant, ceiling: 2_000_000 },
  /** MiB (1,048,576 bytes). */
  uploadFileMiB: { default: 2_048, ceiling: 2_048 },
  /** GiB (1,073,741,824 bytes). */
  vaultQuotaGiB: { default: 50, ceiling: 1_024 },
};

export const MIB = 1024 * 1024;
export const GIB = 1024 * MIB;

/** The largest raw file any plant may send, in bytes (the `uploadFileMiB` ceiling). */
export const UPLOAD_FILE_CEILING_BYTES = PLANT_LIMITS.uploadFileMiB.ceiling * MIB;

/** The most pages in one batch (the plant's `visionPagesPerBatch` is clamped to it). */
export const VISION_PAGES_CEILING = PLANT_LIMITS.visionPagesPerBatch.ceiling;

/** The highest page number any vision call may name (zod bound; the file's plan is checked in the handler). */
export const VISION_FILE_MAX_PAGES = 10_000;

export type PlantLimits = Record<PlantLimitKey, number>;

/** What a plant has set: only the keys it changed. */
export type PlantLimitsSet = Partial<PlantLimits>;

export function isPlantLimitKey(key: string): key is PlantLimitKey {
  return (PLANT_LIMIT_KEYS as readonly string[]).includes(key);
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A usable stored value: a whole number of at least 1. Anything else reads as not set. */
function usable(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/** The keys a plant has set, as stored (unknown keys and unusable values left out, never clamped). */
export function setLimits(settings: unknown): PlantLimitsSet {
  const raw = isRecord(settings) && isRecord(settings.limits) ? settings.limits : {};
  const out: PlantLimitsSet = {};
  for (const key of PLANT_LIMIT_KEYS) {
    const v = raw[key];
    if (usable(v)) out[key] = v;
  }
  return out;
}

/** Every limit for a plant: its set value clamped to the ceiling, else the default. */
export function resolveLimits(settings: unknown): PlantLimits {
  const set = setLimits(settings);
  const out = {} as PlantLimits;
  for (const key of PLANT_LIMIT_KEYS) {
    const def = PLANT_LIMITS[key];
    out[key] = Math.min(set[key] ?? def.default, def.ceiling);
  }
  return out;
}

/** The three model caps as `caps.ts` reads them. */
export function modelCaps(limits: PlantLimits): CapValues {
  return {
    blockCalls: limits.blockModelCalls,
    dayCalls: limits.dayModelCalls,
    dayCostMicro: limits.dayModelCostCents * MICRO_PER_CENT,
  };
}

export type LimitProblem = { key: string; problem: "unknown" | "not_whole" | "below_one" | "above_ceiling" };

/** Problems with a staff change (`null` = use the default). Empty when every key and value is fine. */
export function limitProblems(change: Record<string, number | null>): LimitProblem[] {
  const out: LimitProblem[] = [];
  for (const [key, value] of Object.entries(change)) {
    if (!isPlantLimitKey(key)) {
      out.push({ key, problem: "unknown" });
      continue;
    }
    if (value === null) continue;
    if (!Number.isInteger(value)) out.push({ key, problem: "not_whole" });
    else if (value < 1) out.push({ key, problem: "below_one" });
    else if (value > PLANT_LIMITS[key].ceiling) out.push({ key, problem: "above_ceiling" });
  }
  return out;
}

/** Measured cost of one band read in the vision EVAL (about 0.07 USD), in micro-USD. */
export const BAND_READ_MICRO = 70_000;

/** Roughly how many dense page parts (band reads) a day cost cap in cents pays for, rounded for a sentence. */
export function bandReadsFor(costCents: number): number {
  const n = Math.floor((costCents * MICRO_PER_CENT) / BAND_READ_MICRO);
  return n >= 20 ? Math.round(n / 10) * 10 : n;
}
