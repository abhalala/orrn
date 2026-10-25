/**
 * Ageing (FP-AG, W3-AG-C contracts). Pure rules for the oven: recipe compliance from the temperature
 * log, hardness verdicts, release plans, the batch and row state machines, load eligibility (press
 * lines and bundles), the derived bundle ageing state that dispatch reads, oven capacity, kilogram
 * proration, and the dev oven simulator's curve. No I/O; the server lane calls these and turns each
 * refusal code into the sentence in `packages/server/src/lib/ageingRefusals.ts`.
 *
 * Units: temperatures and hardness ×10 (`1850` = 185.0 °C), times in epoch ms, durations in whole
 * minutes, grams, millimetres, gas in thousandths of the meter unit.
 *
 * The enum lists mirror `packages/db/src/schema/ageing.ts` (pinned equal by the server contract test).
 */

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export const AGEING_MASTER_STATUSES = ["draft", "active", "out_of_service"] as const;
export type AgeingMasterStatus = (typeof AGEING_MASTER_STATUSES)[number];
export const AGEING_RECIPE_KINDS = ["full", "top_up"] as const;
export type AgeingRecipeKind = (typeof AGEING_RECIPE_KINDS)[number];
export const AGEING_RECIPE_STATUSES = ["draft", "active", "archived"] as const;
export type AgeingRecipeStatus = (typeof AGEING_RECIPE_STATUSES)[number];
export const HARDNESS_METHODS = ["webster", "hb"] as const;
export type HardnessMethod = (typeof HARDNESS_METHODS)[number];

export const AGEING_BATCH_STATUSES = ["loading", "in_oven", "out", "released", "held", "closed", "void"] as const;
export type AgeingBatchStatus = (typeof AGEING_BATCH_STATUSES)[number];
/** Statuses that still hold the trolley (one unfinished batch per rack, Q6). */
export const AGEING_OPEN_BATCH_STATUSES = ["loading", "in_oven", "out", "released", "held"] as const satisfies readonly AgeingBatchStatus[];
export const AGEING_ROW_STATUSES = ["pending", "held", "released", "closed", "void"] as const;
export type AgeingRowStatus = (typeof AGEING_ROW_STATUSES)[number];
export const AGEING_ROW_SOURCES = ["press", "manual", "bundle"] as const;
export type AgeingRowSource = (typeof AGEING_ROW_SOURCES)[number];
export const AGEING_TEMP_SOURCES = ["typed", "telemetry", "simulator"] as const;
export type AgeingTempSource = (typeof AGEING_TEMP_SOURCES)[number];
export const AGEING_SOAK_VERDICTS = ["ok", "under_aged", "over_aged", "no_readings"] as const;
export type AgeingSoakVerdict = (typeof AGEING_SOAK_VERDICTS)[number];
export const AGEING_QC_VERDICTS = ["pass", "fail", "override"] as const;
export type AgeingQcVerdict = (typeof AGEING_QC_VERDICTS)[number];
export const AGEING_DISPOSITIONS = ["rework", "scrapped"] as const;
export type AgeingDisposition = (typeof AGEING_DISPOSITIONS)[number];

/**
 * The board phase: the stored status with `in_oven` split by the log into `heating` (no reading
 * inside the band yet) and `soaking` (the soak clock is running). Never stored.
 */
export const AGEING_PHASES = ["loading", "heating", "soaking", "out", "released", "held", "closed", "void"] as const;
export type AgeingPhase = (typeof AGEING_PHASES)[number];

/** Reason codes of kind `ageing_reject` that a release writes on a failed line (seeded in reasonCodes.ts). */
export const AGEING_REJECT_CODES = ["under_aged", "over_aged", "no_readings", "hardness_low", "too_few_samples"] as const;
export type AgeingRejectCode = (typeof AGEING_REJECT_CODES)[number];

// ---------------------------------------------------------------------------
// Limits (zod in lib/ageingContracts.ts reads these)
// ---------------------------------------------------------------------------

export const AGEING_TEMP_MIN_X10 = 0;
/** 300.0 °C: no ageing cycle runs hotter; a typed 1850 for 185.0 is the common slip this catches. */
export const AGEING_TEMP_MAX_X10 = 3000;
export const AGEING_TOLERANCE_DEFAULT_X10 = 100;
export const AGEING_TOLERANCE_MAX_X10 = 500;
export const AGEING_SOAK_MAX_MIN = 2880;
export const AGEING_SAMPLE_COUNT_DEFAULT = 3;
export const AGEING_SAMPLE_COUNT_MAX = 10;
/** Webster runs 0–20, Brinell to about 120 on these alloys; 200.0 is a typo guard. */
export const AGEING_HARDNESS_MAX_X10 = 2000;
export const AGEING_HARDNESS_READINGS_MAX = 10;
export const AGEING_BACKDATE_MAX_MS = 12 * 3_600_000;
/** Readings are accepted for this long after take-out (typed late), never later. */
export const AGEING_TEMP_AFTER_OUT_MS = 30 * 60_000;
/** Minutes above the band a cycle may carry before it is over-aged (a burner overshoot is not a fail). */
export const AGEING_OVER_TEMP_GRACE_MIN = 15;
/**
 * How long one reading stands for the oven (review I2): a reading holds until the next one or for
 * this many minutes, whichever is sooner. Time past it is `unknownMin` (neither in nor out of the
 * band). Equal to the over-temperature grace, so one stray 196 °C typed between hourly readings can
 * never over-age a batch on its own, and one in-band reading cannot carry a 4 h soak. A log that
 * should prove the soak needs a reading every 15 minutes: the simulator and a collector post that
 * often; an operator typing by hand types that often, or the release goes to an override.
 */
export const AGEING_READING_HOLD_MAX_MIN = 15;
/** A telemetry or simulator reading may sit this far ahead of ORRN's clock (a device clock running fast). */
export const AGEING_FEED_FUTURE_SLACK_MS = 2 * 60_000;
export const AGEING_SPLIT_TOLERANCE_MM = 25;
export const AGEING_SPLIT_CUTS_MAX = 10;
export const AGEING_LOAD_MAX_ROWS = 40;
/** Telemetry or simulator readings per post. */
export const AGEING_READINGS_MAX = 50;
export const AGEING_GAS_MAX_MILLI = 999_999_999_999;
export const AGEING_CAPACITY_NEAR_BP = 9500;
export const AGEING_CODE_MAX = 16;
export const AGEING_NOTE_MAX = 500;

// ---------------------------------------------------------------------------
// Refusal codes (sentences: packages/server/src/lib/ageingRefusals.ts; words: ageing.refusal.*)
// ---------------------------------------------------------------------------

export const AGEING_REFUSAL_CODES = [
  // masters
  "oven_not_active",
  "oven_busy",
  "oven_too_hot",
  "trolley_not_active",
  "trolley_busy",
  "recipe_not_active",
  "recipe_max_soak_below_soak",
  "recipe_hardness_max_below_min",
  "code_taken",
  "code_invalid",
  "recipe_active_locked",
  "oven_in_use",
  "trolley_in_use",
  "reason_wrong_kind",
  // load
  "no_rows",
  "too_many_rows",
  "run_not_logged",
  "over_line",
  "manual_off",
  "bundle_not_available",
  "bundle_on_batch",
  "bundle_already_aged",
  "alloy_mismatch",
  "temper_mismatch",
  // cycle
  "wrong_status",
  "no_shifts",
  "shift_unknown",
  "time_future",
  "backdate_too_far",
  "gas_end_below_start",
  "no_reading",
  "out_before_in",
  "reading_closed",
  "reading_before_in",
  // release, override
  "override_pending",
  "override_not_needed",
  "simulator_off",
  // hold, void, rework, discard, split
  "already_held",
  "not_held",
  "hold_after_pack",
  "void_in_oven",
  "void_after_pack",
  "void_reason_missing",
  "void_after_rework",
  "nothing_to_rework",
  "discard_over",
  "split_off",
  "split_after_pack",
  "split_length",
  // pack and dispatch
  "not_released",
  "draw_over",
  "cast_mismatch",
  "ageing_row_required",
  "row_void",
  "bundle_in_ageing",
  "bundle_ageing_held",
  "bundle_not_aged",
  // not found
  "batch_not_found",
  "oven_not_found",
  "trolley_not_found",
  "recipe_not_found",
] as const;
export type AgeingRefusalCode = (typeof AGEING_REFUSAL_CODES)[number];

// ---------------------------------------------------------------------------
// State machines
// ---------------------------------------------------------------------------

/**
 * Batch moves. `closed → released` is the bundle-void restore (remaining no longer 0).
 * `released → held` is a whole-trolley hold before any pack; `held → closed` is rework moving every piece.
 */
export const AGEING_BATCH_TRANSITIONS: Record<AgeingBatchStatus, readonly AgeingBatchStatus[]> = {
  loading: ["in_oven", "void"],
  in_oven: ["out"],
  out: ["released", "held", "void"],
  released: ["held", "closed"],
  held: ["released", "closed", "void"],
  closed: ["released"],
  void: [],
};

export const AGEING_ROW_TRANSITIONS: Record<AgeingRowStatus, readonly AgeingRowStatus[]> = {
  pending: ["released", "held", "void"],
  held: ["released", "closed", "void"],
  released: ["held", "closed"],
  closed: ["released"],
  void: [],
};

export const canMoveAgeingBatch = (from: AgeingBatchStatus, to: AgeingBatchStatus): boolean => AGEING_BATCH_TRANSITIONS[from].includes(to);
export const canMoveAgeingRow = (from: AgeingRowStatus, to: AgeingRowStatus): boolean => AGEING_ROW_TRANSITIONS[from].includes(to);
export const isOpenAgeingBatch = (status: AgeingBatchStatus): boolean => (AGEING_OPEN_BATCH_STATUSES as readonly string[]).includes(status);

/** The board phase of a batch (see AGEING_PHASES). */
export function ageingBatchPhase(batch: { status: AgeingBatchStatus; soakStartedAt: Date | number | null }): AgeingPhase {
  if (batch.status === "in_oven") return batch.soakStartedAt == null ? "heating" : "soaking";
  return batch.status;
}

// ---------------------------------------------------------------------------
// Pieces and kilograms
// ---------------------------------------------------------------------------

export type AgeingRowCounts = { pcs: number; packedPcs: number; scrapPcs: number; reworkPcs: number };

/** Server remaining: pcs − packed − scrap − rework (never below 0). A client never subtracts columns itself. */
export function ageingRowRemaining(r: AgeingRowCounts): number {
  return Math.max(0, r.pcs - r.packedPcs - r.scrapPcs - r.reworkPcs);
}

/** All counts whole, none negative, and what left the row is not more than was loaded. */
export function ageingRowCountsValid(r: AgeingRowCounts): boolean {
  const all = [r.pcs, r.packedPcs, r.scrapPcs, r.reworkPcs];
  return all.every((n) => Number.isInteger(n) && n >= 0) && r.packedPcs + r.scrapPcs + r.reworkPcs <= r.pcs;
}

export type AgeingBatchTotals = {
  loadedPcs: number;
  packedPcs: number;
  scrapPcs: number;
  reworkPcs: number;
  remainingPcs: number;
  /** Remaining on released rows: what pack may take. */
  packablePcs: number;
  /** Remaining on held rows. */
  heldPcs: number;
  /** Remaining on pending rows (in the oven, or out and untested). */
  pendingPcs: number;
  loadedKgG: number;
  /** kg_g prorated by remaining pieces, per row, floored. Labelled theoretical; never loaded − packed scale kg. */
  theoreticalRemainingKgG: number;
};

/** Header figures from the lines (void rows do not count). loaded = packed + scrap + rework + remaining, always. */
export function ageingBatchTotals(rows: readonly (AgeingRowCounts & { status: AgeingRowStatus; kgG: number })[]): AgeingBatchTotals {
  const t: AgeingBatchTotals = {
    loadedPcs: 0,
    packedPcs: 0,
    scrapPcs: 0,
    reworkPcs: 0,
    remainingPcs: 0,
    packablePcs: 0,
    heldPcs: 0,
    pendingPcs: 0,
    loadedKgG: 0,
    theoreticalRemainingKgG: 0,
  };
  for (const r of rows) {
    if (r.status === "void") continue;
    const left = ageingRowRemaining(r);
    t.loadedPcs += r.pcs;
    t.packedPcs += r.packedPcs;
    t.scrapPcs += r.scrapPcs;
    t.reworkPcs += r.reworkPcs;
    t.remainingPcs += left;
    if (r.status === "released") t.packablePcs += left;
    if (r.status === "held") t.heldPcs += left;
    if (r.status === "pending") t.pendingPcs += left;
    t.loadedKgG += r.kgG;
    t.theoreticalRemainingKgG += r.pcs > 0 ? Math.floor((r.kgG * left) / r.pcs) : 0;
  }
  return t;
}

/**
 * Split `total` over `weights` by largest remainder: whole numbers that sum to `total` exactly.
 * Ties go to the earlier part. All weights 0 → everything on the last part.
 */
export function largestRemainder(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map((_, i) => (i === weights.length - 1 ? total : 0));
  const exact = weights.map((w) => (total * w) / sum);
  const out = exact.map((x) => Math.floor(x));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i]! += 1;
    left -= 1;
  }
  return out;
}

/**
 * Theoretical grams for `takePcs` pieces loaded from a press line. What is left of the line's grams
 * goes with what is left of its pieces, so loading the last pieces always sums back to `good_g`.
 */
export function ageingLoadKgG(input: { lineGoodG: number; linePcs: number; loadedPcs: number; loadedKgG: number; takePcs: number }): number {
  const pcsLeft = input.linePcs - input.loadedPcs;
  const kgLeft = Math.max(0, input.lineGoodG - input.loadedKgG);
  if (pcsLeft <= 0 || input.takePcs <= 0) return 0;
  if (input.takePcs >= pcsLeft) return kgLeft;
  return Math.round((kgLeft * input.takePcs) / pcsLeft);
}

/** Oven (or trolley) load against its capacity; a warning, never a block. */
export function ageingCapacity(loadG: number, capacityG: number | null | undefined): "ok" | "near" | "over" | "unknown" {
  if (capacityG == null || capacityG <= 0) return "unknown";
  if (loadG > capacityG) return "over";
  return loadG * 10_000 > capacityG * AGEING_CAPACITY_NEAR_BP ? "near" : "ok";
}

// ---------------------------------------------------------------------------
// Temperature log → soak compliance (FP-AG-06)
// ---------------------------------------------------------------------------

export type AgeingReading = { at: number; tempCX10: number };
export type AgeingSoakSnapshot = { targetTempX10: number; toleranceX10: number; soakMin: number; maxSoakMin: number | null };

export const ageingBandLow = (s: Pick<AgeingSoakSnapshot, "targetTempX10" | "toleranceX10">): number => s.targetTempX10 - s.toleranceX10;
export const ageingBandHigh = (s: Pick<AgeingSoakSnapshot, "targetTempX10" | "toleranceX10">): number => s.targetTempX10 + s.toleranceX10;
/** Inside target ± tolerance, both ends included. */
export const ageingInBand = (tempCX10: number, s: Pick<AgeingSoakSnapshot, "targetTempX10" | "toleranceX10">): boolean =>
  tempCX10 >= ageingBandLow(s) && tempCX10 <= ageingBandHigh(s);

export type SoakCompliance = {
  verdict: AgeingSoakVerdict;
  /** The first in-band reading at or after in_at (the soak clock start), else null. */
  soakStartedAt: number | null;
  /** Minutes inside the band (each reading holds until the next one, at most AGEING_READING_HOLD_MAX_MIN). */
  inBandMin: number;
  aboveBandMin: number;
  belowBandMin: number;
  /** Minutes no reading stands for (gaps past the hold cap, and in_at to the first reading after the ramp). */
  unknownMin: number;
  /** end − soakStartedAt (the spec's wall-clock soak), 0 when the soak never started. */
  soakElapsedMin: number;
  minX10: number | null;
  maxX10: number | null;
  readingCount: number;
  /** True only for verdict `ok`. */
  met: boolean;
};

const MIN_MS = 60_000;

/**
 * Recipe compliance from the log, between `inAt` and `end` (out_at, else now). Each reading holds
 * until the next one, or for `AGEING_READING_HOLD_MAX_MIN` (review I2), whichever is sooner; the
 * rest of a longer gap is unknown time and counts for nothing. Readings outside the window are
 * ignored. Verdict order: no readings → over-aged (above the band past the grace, or longer at
 * temperature than `maxSoakMin`) → under-aged (soak never started, or less time in the band than
 * `soakMin`) → ok. Over wins: a top-up cannot undo it.
 */
export function soakCompliance(input: {
  readings: readonly AgeingReading[];
  snapshot: AgeingSoakSnapshot;
  inAt: number;
  outAt: number | null;
  now: number;
  overTempGraceMin?: number;
  holdMaxMin?: number;
}): SoakCompliance {
  const end = input.outAt ?? input.now;
  const rs = input.readings.filter((r) => r.at >= input.inAt && r.at <= end).sort((a, b) => a.at - b.at);
  const holdMs = (input.holdMaxMin ?? AGEING_READING_HOLD_MAX_MIN) * MIN_MS;
  let inMs = 0;
  let aboveMs = 0;
  let belowMs = 0;
  let unknownMs = rs.length > 0 ? Math.max(0, rs[0]!.at - input.inAt) : Math.max(0, end - input.inAt);
  let soakStartedAt: number | null = null;
  let minX10: number | null = null;
  let maxX10: number | null = null;
  const hi = ageingBandHigh(input.snapshot);
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i]!;
    const until = i + 1 < rs.length ? rs[i + 1]!.at : end;
    const gap = Math.max(0, until - r.at);
    const span = Math.min(gap, holdMs);
    unknownMs += gap - span;
    minX10 = minX10 == null ? r.tempCX10 : Math.min(minX10, r.tempCX10);
    maxX10 = maxX10 == null ? r.tempCX10 : Math.max(maxX10, r.tempCX10);
    if (ageingInBand(r.tempCX10, input.snapshot)) {
      if (soakStartedAt == null) soakStartedAt = r.at;
      inMs += span;
    } else if (r.tempCX10 > hi) aboveMs += span;
    else if (soakStartedAt != null) belowMs += span;
  }
  const inBandMin = Math.floor(inMs / MIN_MS);
  const aboveBandMin = Math.floor(aboveMs / MIN_MS);
  const belowBandMin = Math.floor(belowMs / MIN_MS);
  const unknownMin = Math.floor(unknownMs / MIN_MS);
  const soakElapsedMin = soakStartedAt == null ? 0 : Math.floor(Math.max(0, end - soakStartedAt) / MIN_MS);
  const grace = input.overTempGraceMin ?? AGEING_OVER_TEMP_GRACE_MIN;
  let verdict: AgeingSoakVerdict;
  if (rs.length === 0) verdict = "no_readings";
  else if (aboveBandMin > grace || (input.snapshot.maxSoakMin != null && inBandMin > input.snapshot.maxSoakMin)) verdict = "over_aged";
  else if (soakStartedAt == null || inBandMin < input.snapshot.soakMin) verdict = "under_aged";
  else verdict = "ok";
  return { verdict, soakStartedAt, inBandMin, aboveBandMin, belowBandMin, unknownMin, soakElapsedMin, minX10, maxX10, readingCount: rs.length, met: verdict === "ok" };
}

// ---------------------------------------------------------------------------
// Hardness (FP-AG-07)
// ---------------------------------------------------------------------------

export type HardnessRule = { method: HardnessMethod; minX10: number; maxX10: number | null; sampleCount: number };
export type HardnessSample = { method: HardnessMethod; readingX10: number };
export type HardnessSummary = {
  method: HardnessMethod;
  /** Samples of the deciding method (the recipe's). */
  count: number;
  medianX10: number | null;
  /** null = untested (no sample of the deciding method). */
  pass: boolean | null;
  reason: "ok" | "untested" | "too_few" | "below_min";
  /** A sample above the recipe maximum: shown, never a fail. */
  warnHigh: boolean;
};

/** Median of whole numbers; an even count takes the mean of the middle two, rounded half up. */
export function medianX10(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.floor((s[mid - 1]! + s[mid]! + 1) / 2);
}

/** One sample against the snapshot, stored at insert (`ageing_hardness.pass`). Another method never passes. */
export function hardnessSamplePass(sample: HardnessSample, rule: HardnessRule): boolean {
  return sample.method === rule.method && sample.readingX10 >= rule.minX10;
}

/**
 * Line summary (Q2, Q3 defaults): pass when at least `sampleCount` samples of the deciding method are
 * in and every one of them is ≥ min. One soft sample fails the line; the median is only the figure shown.
 */
export function hardnessSummary(samples: readonly HardnessSample[], rule: HardnessRule): HardnessSummary {
  const mine = samples.filter((s) => s.method === rule.method).map((s) => s.readingX10);
  const medianX10v = medianX10(mine);
  const warnHigh = rule.maxX10 != null && mine.some((v) => v > rule.maxX10!);
  const base = { method: rule.method, count: mine.length, medianX10: medianX10v, warnHigh };
  if (mine.length === 0) return { ...base, pass: null, reason: "untested" };
  if (mine.some((v) => v < rule.minX10)) return { ...base, pass: false, reason: "below_min" };
  if (mine.length < rule.sampleCount) return { ...base, pass: false, reason: "too_few" };
  return { ...base, pass: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// Release (FP-AG-08, 11, 14)
// ---------------------------------------------------------------------------

export type AgeingReleaseRow = {
  id: string;
  status: AgeingRowStatus;
  hardness: Pick<HardnessSummary, "pass" | "reason">;
  /** Kind of the reason the row is held for: a manual hold (surface, bend, customer…) survives any release. */
  holdKind: "ageing_hold" | "ageing_reject" | null;
};

export type AgeingReleasePlan =
  | { ok: false; code: Extract<AgeingRefusalCode, "wrong_status" | "no_rows"> }
  | {
      ok: true;
      batchStatus: "released" | "held";
      qcVerdict: AgeingQcVerdict;
      /** Rows that change, with the `ageing_reject` code a failed one is held for. */
      moves: { id: string; to: "released" | "held"; rejectCode: AgeingRejectCode | null }[];
      /** True when a second person could clear what failed (an `ageing_override` request). */
      overrideWouldHelp: boolean;
    };

const rejectOf = (h: AgeingReleaseRow["hardness"]): AgeingRejectCode | null =>
  h.pass === true ? null : h.reason === "below_min" ? "hardness_low" : "too_few_samples";

/**
 * What `ageing.release` does, from `out` or `held`. Rows that are pending, or held for a failed QC
 * verdict (`ageing_reject`), are judged: an approved override releases them; else a soak that is not
 * ok holds them with the soak verdict; else hardness decides (pass → released, otherwise held as
 * hardness_low / too_few_samples). Rows held by hand stay held; released, closed and void rows are
 * not touched. Batch: released if any row ends released, else held (Q11: one failed line does not
 * hold the lines that passed).
 */
export function ageingReleasePlan(input: {
  batchStatus: AgeingBatchStatus;
  soak: AgeingSoakVerdict;
  rows: readonly AgeingReleaseRow[];
  overrideApproved: boolean;
}): AgeingReleasePlan {
  if (input.batchStatus !== "out" && input.batchStatus !== "held") return { ok: false, code: "wrong_status" };
  const live = input.rows.filter((r) => r.status !== "void");
  if (live.length === 0) return { ok: false, code: "no_rows" };
  const moves: { id: string; to: "released" | "held"; rejectCode: AgeingRejectCode | null }[] = [];
  let anyReleased = live.some((r) => r.status === "released" || r.status === "closed");
  let anyFailed = false;
  for (const r of live) {
    const judged = r.status === "pending" || (r.status === "held" && r.holdKind === "ageing_reject");
    if (!judged) continue;
    let to: "released" | "held";
    let rejectCode: AgeingRejectCode | null = null;
    if (input.overrideApproved) to = "released";
    else if (input.soak !== "ok") {
      to = "held";
      rejectCode = input.soak;
    } else {
      rejectCode = rejectOf(r.hardness);
      to = rejectCode ? "held" : "released";
    }
    if (to === "released") anyReleased = true;
    else anyFailed = true;
    if (to !== r.status || rejectCode != null) moves.push({ id: r.id, to, rejectCode });
  }
  const qcVerdict: AgeingQcVerdict = input.overrideApproved ? "override" : anyFailed ? "fail" : "pass";
  return { ok: true, batchStatus: anyReleased ? "released" : "held", qcVerdict, moves, overrideWouldHelp: anyFailed };
}

/**
 * Clear a hand hold (review I5, AG-11: customer, surface, bend…). A QC reject (`ageing_reject`) is not
 * cleared here: a passing retest or an approved override does that. While the batch is `out` the line
 * goes back to `pending` for the release; after a release it is judged on the spot like `ageingReleasePlan`
 * (override → released; soak not ok → held for the soak; hardness → released or held).
 */
export function ageingUnholdPlan(input: {
  batchStatus: AgeingBatchStatus;
  rowStatus: AgeingRowStatus;
  holdKind: "ageing_hold" | "ageing_reject" | null;
  soak: AgeingSoakVerdict;
  overrideApproved: boolean;
  hardness: AgeingReleaseRow["hardness"];
}): { ok: false; code: AgeingRefusalCode } | { ok: true; to: "pending" | "released" | "held"; rejectCode: AgeingRejectCode | null } {
  if (input.rowStatus !== "held" || input.holdKind === "ageing_reject") return { ok: false, code: "not_held" };
  if (input.batchStatus === "out") return { ok: true, to: "pending", rejectCode: null };
  if (input.batchStatus !== "released" && input.batchStatus !== "held") return { ok: false, code: "wrong_status" };
  if (input.overrideApproved) return { ok: true, to: "released", rejectCode: null };
  if (input.soak !== "ok") return { ok: true, to: "held", rejectCode: input.soak };
  const reject = rejectOf(input.hardness);
  return reject ? { ok: true, to: "held", rejectCode: reject } : { ok: true, to: "released", rejectCode: null };
}

/** A released batch closes when no non-void row has pieces left (or rework moved them all). */
export function ageingBatchShouldClose(rows: readonly (AgeingRowCounts & { status: AgeingRowStatus })[]): boolean {
  const live = rows.filter((r) => r.status !== "void");
  return live.length > 0 && live.every((r) => ageingRowRemaining(r) === 0);
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

/** Times a person may type: not in the future, not more than 12 hours back. */
export function ageingTimeGate(at: number, now: number): Extract<AgeingRefusalCode, "time_future" | "backdate_too_far"> | null {
  if (at > now) return "time_future";
  if (now - at > AGEING_BACKDATE_MAX_MS) return "backdate_too_far";
  return null;
}

export type AgeingLoadGateInput = {
  /** The batch being added to (null = a new one on this trolley). */
  batchStatus: AgeingBatchStatus | null;
  trolleyStatus: AgeingMasterStatus;
  /** The trolley is on another unfinished batch. */
  trolleyBusy: boolean;
  rowCount: number;
  manualRows: number;
  manualLoad: boolean;
};

export function ageingLoadGates(input: AgeingLoadGateInput): AgeingRefusalCode[] {
  const out: AgeingRefusalCode[] = [];
  if (input.batchStatus != null && input.batchStatus !== "loading") out.push("wrong_status");
  if (input.trolleyStatus !== "active") out.push("trolley_not_active");
  if (input.trolleyBusy) out.push("trolley_busy");
  if (input.rowCount <= 0) out.push("no_rows");
  if (input.rowCount > AGEING_LOAD_MAX_ROWS) out.push("too_many_rows");
  if (input.manualRows > 0 && !input.manualLoad) out.push("manual_off");
  return out;
}

export type AgeingRecipeMatch = { alloy: string; temper: string };

const sameToken = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** Alloy and temper against a recipe; unknown on the line (null) never blocks. */
export function ageingRecipeMismatch(
  line: { alloy: string | null; temper: string | null },
  recipe: AgeingRecipeMatch | null | undefined,
): Extract<AgeingRefusalCode, "alloy_mismatch" | "temper_mismatch"> | null {
  if (!recipe) return null;
  if (line.alloy && !sameToken(line.alloy, recipe.alloy)) return "alloy_mismatch";
  if (line.temper && !sameToken(line.temper, recipe.temper)) return "temper_mismatch";
  return null;
}

/**
 * What a press line already gave to trolleys (review I4): over non-void rows on non-void batches,
 * pieces are Σ(pcs − rework_pcs) (a reworked piece is counted once, on its successor row) and grams
 * are Σ kg_g of the rows that are not a rework successor (a successor's grams were carved out of its
 * original's). Feed these as `loadedPcs` / `loadedKgG` to `pressLineEligibility` and `ageingLoadKgG`.
 */
export function pressLineLoaded(rows: readonly { pcs: number; reworkPcs: number; kgG: number; status: AgeingRowStatus; isReworkSuccessor: boolean }[]): {
  loadedPcs: number;
  loadedKgG: number;
} {
  let loadedPcs = 0;
  let loadedKgG = 0;
  for (const r of rows) {
    if (r.status === "void") continue;
    loadedPcs += r.pcs - r.reworkPcs;
    if (!r.isReworkSuccessor) loadedKgG += r.kgG;
  }
  return { loadedPcs, loadedKgG };
}

/**
 * A logged press-run line can give `takePcs` pieces: the run is logged, the pieces fit what is left
 * of the line on non-void rows, and the cast's alloy / the order line's temper match the recipe
 * when one is already picked.
 */
export function pressLineEligibility(input: {
  runStatus: string;
  linePcs: number;
  loadedPcs: number;
  takePcs: number;
  alloy: string | null;
  temper: string | null;
  recipe?: AgeingRecipeMatch | null;
}): AgeingRefusalCode | null {
  if (input.runStatus !== "logged") return "run_not_logged";
  if (!Number.isInteger(input.takePcs) || input.takePcs < 1 || input.takePcs > input.linePcs - input.loadedPcs) return "over_line";
  return ageingRecipeMismatch({ alloy: input.alloy, temper: input.temper }, input.recipe);
}

/**
 * A packed bundle can go on a trolley whole: it is in stock (`available`), not already aged, not on
 * another unfinished batch, and its alloy / temper match the recipe when one is picked.
 */
export function bundleEligibility(input: {
  status: string;
  ageingRowId: string | null;
  onOpenBatch: boolean;
  alloy: string | null;
  temper: string | null;
  recipe?: AgeingRecipeMatch | null;
}): AgeingRefusalCode | null {
  if (input.status !== "available") return "bundle_not_available";
  if (input.onOpenBatch) return "bundle_on_batch";
  if (input.ageingRowId) return "bundle_already_aged";
  return ageingRecipeMismatch({ alloy: input.alloy, temper: input.temper }, input.recipe);
}

export type AgeingStartGateInput = {
  batchStatus: AgeingBatchStatus;
  rowCount: number;
  oven: { status: AgeingMasterStatus; busy: boolean; maxTempX10: number | null } | null;
  recipe: { status: AgeingRecipeStatus; alloy: string; temper: string; targetTempX10: number; toleranceX10: number } | null;
  trolleyStatus: AgeingMasterStatus;
  shiftsConfigured: boolean;
  shiftKnown: boolean;
  rows: readonly { alloy: string | null; temper: string | null }[];
  inAt: number;
  now: number;
};

/** Start (Q13: no shifts → blocked). Every refusal at once, in screen order. */
export function ageingStartGates(input: AgeingStartGateInput): AgeingRefusalCode[] {
  const out: AgeingRefusalCode[] = [];
  if (input.batchStatus !== "loading") out.push("wrong_status");
  if (input.rowCount <= 0) out.push("no_rows");
  if (!input.oven) out.push("oven_not_found");
  else {
    if (input.oven.status !== "active") out.push("oven_not_active");
    if (input.oven.busy) out.push("oven_busy");
  }
  if (!input.recipe) out.push("recipe_not_found");
  else {
    if (input.recipe.status !== "active") out.push("recipe_not_active");
    if (input.oven?.maxTempX10 != null && input.recipe.targetTempX10 + input.recipe.toleranceX10 > input.oven.maxTempX10) out.push("oven_too_hot");
    for (const r of input.rows) {
      const m = ageingRecipeMismatch(r, input.recipe);
      if (m && !out.includes(m)) out.push(m);
    }
  }
  if (input.trolleyStatus !== "active") out.push("trolley_not_active");
  if (!input.shiftsConfigured) out.push("no_shifts");
  else if (!input.shiftKnown) out.push("shift_unknown");
  const t = ageingTimeGate(input.inAt, input.now);
  if (t) out.push(t);
  return out;
}

/** A gas start below the oven's last end is a warning (meter replaced?) unless the operator said reset (Q4). */
export function ageingGasWarning(input: { gasStartMilli: number; lastGasEndMilli: number | null; meterReset: boolean }): "gas_backwards" | null {
  if (input.meterReset || input.lastGasEndMilli == null) return null;
  return input.gasStartMilli < input.lastGasEndMilli ? "gas_backwards" : null;
}

export function ageingGasUsedMilli(start: number | null, end: number | null): number | null {
  return start == null || end == null || end < start ? null : end - start;
}

/** Take-out: one reading at least, gas end ≥ start, out after in, a typeable time. A short soak does not block take-out. */
export function ageingTakeOutGates(input: {
  batchStatus: AgeingBatchStatus;
  readingCount: number;
  gasStartMilli: number | null;
  gasEndMilli: number;
  inAt: number | null;
  outAt: number;
  now: number;
}): AgeingRefusalCode[] {
  const out: AgeingRefusalCode[] = [];
  if (input.batchStatus !== "in_oven") out.push("wrong_status");
  if (input.readingCount <= 0) out.push("no_reading");
  if (input.gasStartMilli != null && input.gasEndMilli < input.gasStartMilli) out.push("gas_end_below_start");
  if (input.inAt != null && input.outAt <= input.inAt) out.push("out_before_in");
  const t = ageingTimeGate(input.outAt, input.now);
  if (t) out.push(t);
  return out;
}

/**
 * A temperature reading: in the oven, or within 30 minutes after take-out; not before in_at; not in
 * the future (a telemetry or simulator reading may run AGEING_FEED_FUTURE_SLACK_MS ahead, review m3).
 */
export function ageingReadingGates(input: {
  batchStatus: AgeingBatchStatus;
  inAt: number | null;
  outAt: number | null;
  at: number;
  now: number;
  source?: AgeingTempSource;
}): AgeingRefusalCode[] {
  const out: AgeingRefusalCode[] = [];
  if (input.batchStatus === "in_oven") {
    // open
  } else if (input.batchStatus === "out" && input.outAt != null) {
    if (input.now - input.outAt > AGEING_TEMP_AFTER_OUT_MS) out.push("reading_closed");
  } else out.push("wrong_status");
  const slack = input.source === "telemetry" || input.source === "simulator" ? AGEING_FEED_FUTURE_SLACK_MS : 0;
  if (input.at > input.now + slack) out.push("time_future");
  if (input.inAt != null && input.at < input.inAt) out.push("reading_before_in");
  return out;
}

/** Hardness may be recorded once the batch is out (out, released or held) on a live row. */
export function ageingHardnessGates(input: { batchStatus: AgeingBatchStatus; rowStatus: AgeingRowStatus }): AgeingRefusalCode[] {
  const open = input.batchStatus === "out" || input.batchStatus === "released" || input.batchStatus === "held";
  return open && input.rowStatus !== "void" && input.rowStatus !== "closed" ? [] : ["wrong_status"];
}

/**
 * Hold a whole trolley (only before any pack) or one line. The batch must be out or later and open.
 */
export function ageingHoldGates(input: {
  scope: "batch" | "row";
  batchStatus: AgeingBatchStatus;
  rows: readonly { status: AgeingRowStatus; packedPcs: number; source?: AgeingRowSource }[];
  rowStatus?: AgeingRowStatus;
}): AgeingRefusalCode[] {
  const open = input.batchStatus === "out" || input.batchStatus === "released" || input.batchStatus === "held";
  if (!open) return ["wrong_status"];
  if (input.scope === "batch") {
    // A bundle row is packed by definition; only trolley pieces taken by pack count here.
    return input.rows.some((r) => r.status !== "void" && r.source !== "bundle" && r.packedPcs > 0) ? ["hold_after_pack"] : [];
  }
  if (input.rowStatus === "held") return ["already_held"];
  if (input.rowStatus === "void" || input.rowStatus === "closed") return ["wrong_status"];
  return [];
}

/**
 * Pieces of trolley rows taken by pack (review I3: a whole-bundle row is not "packed" from the trolley;
 * its `packed_pcs` is written only when release passes it).
 */
export function ageingAnyPacked(rows: readonly { status: AgeingRowStatus; packedPcs: number; source?: AgeingRowSource }[]): boolean {
  return rows.some((r) => r.status !== "void" && r.source !== "bundle" && r.packedPcs > 0);
}

/** Pieces moved off a row by rework or discard (review I4: a void must not free them twice). */
export function ageingAnyMoved(rows: readonly { status: AgeingRowStatus; scrapPcs: number; reworkPcs: number }[]): boolean {
  return rows.some((r) => r.status !== "void" && r.scrapPcs + r.reworkPcs > 0);
}

/**
 * Void (abort): from loading freely; from out or held only when nothing was packed, reworked or
 * discarded, with an `ageing_abort` reason; never in the oven (take it out first); never once
 * released (hold it first); never a rework successor (its pieces belong to the held batch it came from).
 */
export function ageingVoidGates(input: {
  batchStatus: AgeingBatchStatus;
  anyPacked: boolean;
  reasonGiven: boolean;
  /** Any row has scrap_pcs or rework_pcs (`ageingAnyMoved`), or the batch is a rework successor. */
  anyMoved?: boolean;
}): AgeingRefusalCode[] {
  if (input.batchStatus === "in_oven") return ["void_in_oven"];
  if (input.anyMoved) return ["void_after_rework"];
  if (input.batchStatus === "loading") return [];
  if (input.batchStatus !== "out" && input.batchStatus !== "held") return ["wrong_status"];
  const out: AgeingRefusalCode[] = [];
  if (input.anyPacked) out.push("void_after_pack");
  if (!input.reasonGiven) out.push("void_reason_missing");
  return out;
}

/**
 * Pieces pack may draw from a row (`drawAgeingRow`): a released trolley row (a whole-bundle row is
 * already a bundle and is never on the pack list), and not more than remaining (`draw_over`).
 */
export function ageingDrawGate(input: { rowStatus: AgeingRowStatus; remainingPcs: number; pcs: number; source?: AgeingRowSource }): AgeingRefusalCode | null {
  if (input.rowStatus !== "released" || input.source === "bundle") return "not_released";
  if (!Number.isInteger(input.pcs) || input.pcs < 1 || input.pcs > input.remainingPcs) return "draw_over";
  return null;
}

/** Discard the rest of a line (writes scrap_pcs only; any weighed scrap is pack's posting). */
export function ageingDiscardGate(input: { rowStatus: AgeingRowStatus; remainingPcs: number; pcs: number }): AgeingRefusalCode | null {
  if (input.rowStatus === "void" || input.rowStatus === "closed") return "wrong_status";
  if (!Number.isInteger(input.pcs) || input.pcs < 1 || input.pcs > input.remainingPcs) return "discard_over";
  return null;
}

/**
 * Rework (FP-AG-12): every held row with pieces left moves them to a successor batch (rework_pcs).
 * Returns the rows that move and their pieces, or a refusal.
 */
export function ageingReworkPlan(input: {
  batchStatus: AgeingBatchStatus;
  rows: readonly (AgeingRowCounts & { id: string; status: AgeingRowStatus; kgG: number })[];
}): { ok: false; code: AgeingRefusalCode } | { ok: true; moves: { rowId: string; pcs: number; kgG: number }[]; closesBatch: boolean } {
  if (input.batchStatus !== "held" && input.batchStatus !== "released") return { ok: false, code: "wrong_status" };
  const moves = input.rows
    .filter((r) => r.status === "held" && ageingRowRemaining(r) > 0)
    .map((r) => {
      const pcs = ageingRowRemaining(r);
      // Review m7: the whole row's grams when every piece moves; else rounded, never above the row.
      const kgG = r.pcs <= 0 ? 0 : pcs >= r.pcs ? r.kgG : Math.min(r.kgG, Math.round((r.kgG * pcs) / r.pcs));
      return { rowId: r.id, pcs, kgG };
    });
  if (moves.length === 0) return { ok: false, code: "nothing_to_rework" };
  const after = input.rows.map((r) => {
    const m = moves.find((x) => x.rowId === r.id);
    return m ? { ...r, reworkPcs: r.reworkPcs + m.pcs } : r;
  });
  return { ok: true, moves, closesBatch: ageingBatchShouldClose(after) };
}

/**
 * Split a row into other cut lengths (setting `ageing.split`, default off; Q14 A). Only while nothing
 * was packed from it and it is pending or released. Σ pcs × length must equal the row's within 25 mm;
 * grams are prorated by length × pieces and sum to the row's exactly. The first cut stays on the row.
 */
export function ageingSplitPlan(input: {
  splitOn: boolean;
  row: { pcs: number; lengthMm: number; kgG: number; packedPcs: number; scrapPcs?: number; reworkPcs?: number; status: AgeingRowStatus; source?: AgeingRowSource };
  cuts: readonly { lengthMm: number; pcs: number }[];
  /** The row's batch (review m2: a closed or void batch is never split). */
  batchStatus?: AgeingBatchStatus;
}): { ok: false; code: AgeingRefusalCode } | { ok: true; parts: { lengthMm: number; pcs: number; kgG: number }[] } {
  if (!input.splitOn) return { ok: false, code: "split_off" };
  if (input.row.packedPcs > 0 || (input.row.scrapPcs ?? 0) > 0 || (input.row.reworkPcs ?? 0) > 0) return { ok: false, code: "split_after_pack" };
  if (input.row.status !== "pending" && input.row.status !== "released") return { ok: false, code: "wrong_status" };
  if (input.row.source === "bundle") return { ok: false, code: "wrong_status" };
  if (input.batchStatus != null && !isOpenAgeingBatch(input.batchStatus)) return { ok: false, code: "wrong_status" };
  const bad = input.cuts.length < 2 || input.cuts.length > AGEING_SPLIT_CUTS_MAX || input.cuts.some((c) => !Number.isInteger(c.pcs) || c.pcs < 1 || c.lengthMm < 1);
  const total = input.cuts.reduce((a, c) => a + c.pcs * c.lengthMm, 0);
  if (bad || Math.abs(total - input.row.pcs * input.row.lengthMm) > AGEING_SPLIT_TOLERANCE_MM) return { ok: false, code: "split_length" };
  const grams = largestRemainder(input.row.kgG, input.cuts.map((c) => c.pcs * c.lengthMm));
  return { ok: true, parts: input.cuts.map((c, i) => ({ lengthMm: c.lengthMm, pcs: c.pcs, kgG: grams[i]! })) };
}

// ---------------------------------------------------------------------------
// The bundle's ageing state (dispatch and stock read it; `bundle.status` is unchanged)
// ---------------------------------------------------------------------------

/**
 * Derived, never stored: `bundle.status` keeps its four values (available, reserved, dispatched,
 * void) so the ledger projection and every stock reader stay as they are. A bundle on an unfinished
 * batch (source `bundle`) is `in_ageing` (row pending) or `held` (row held); a bundle that came off
 * a released row (pack draw, or its own bundle row released) is `aged` (`bundle.ageing_row_id` set);
 * anything else is `not_aged`.
 */
export const BUNDLE_AGEING_STATES = ["not_aged", "in_ageing", "held", "aged"] as const;
export type BundleAgeingState = (typeof BUNDLE_AGEING_STATES)[number];

export const BUNDLE_AGEING_TRANSITIONS: Record<BundleAgeingState, readonly BundleAgeingState[]> = {
  // load on a trolley (source bundle)
  not_aged: ["in_ageing"],
  // release passed / release failed or held / batch voided
  in_ageing: ["aged", "held", "not_aged"],
  // retest passed or override / reworked onto a successor / batch voided
  held: ["aged", "in_ageing", "not_aged"],
  // aged metal is never un-aged
  aged: [],
};

export function bundleAgeingState(input: {
  ageingRowId: string | null;
  /** The bundle's row on an unfinished batch (source `bundle`), if any. */
  openRow: { status: AgeingRowStatus } | null;
}): BundleAgeingState {
  if (input.openRow) {
    if (input.openRow.status === "pending") return "in_ageing";
    if (input.openRow.status === "held") return "held";
    if (input.openRow.status === "released" || input.openRow.status === "closed") return "aged";
  }
  return input.ageingRowId ? "aged" : "not_aged";
}

/**
 * Dispatch (scan and reserve) refuses a bundle that is in the oven or held there, always; and one
 * that was never aged when the plant setting `ageing.requireAgeing` is on (default off). Bundles
 * packed before `requireAgeingSince` (company day `YYYY-MM-DD`) are exempt, so turning it on never
 * strands yard stock.
 */
export function dispatchAgeingRefusal(input: {
  state: BundleAgeingState;
  requireAgeing: boolean;
  requireAgeingSince: string | null;
  packedDay: string;
}): Extract<AgeingRefusalCode, "bundle_in_ageing" | "bundle_ageing_held" | "bundle_not_aged"> | null {
  if (input.state === "in_ageing") return "bundle_in_ageing";
  if (input.state === "held") return "bundle_ageing_held";
  if (input.state === "aged" || !input.requireAgeing) return null;
  if (input.requireAgeingSince && input.packedDay < input.requireAgeingSince) return null;
  return "bundle_not_aged";
}

// ---------------------------------------------------------------------------
// Masters
// ---------------------------------------------------------------------------

/** A floor code (`OV-1`, `T-1`): trimmed, upper case, letters / digits / dash, 1–16. null when invalid. */
export function normalizeAgeingCode(raw: string): string | null {
  const c = raw.trim().toUpperCase().replace(/\s+/g, "-");
  return /^[A-Z0-9][A-Z0-9-]{0,15}$/.test(c) ? c : null;
}

export type AgeingRecipeNumbers = {
  targetTempX10: number;
  toleranceX10: number;
  soakMin: number;
  maxSoakMin: number | null;
  hardnessMinX10: number;
  hardnessMaxX10: number | null;
  sampleCount: number;
};

/** Cross-field rules zod cannot see. Ranges are zod's (lib/ageingContracts.ts). */
export function ageingRecipeErrors(r: AgeingRecipeNumbers): AgeingRefusalCode[] {
  const out: AgeingRefusalCode[] = [];
  if (r.maxSoakMin != null && r.maxSoakMin <= r.soakMin) out.push("recipe_max_soak_below_soak");
  if (r.hardnessMaxX10 != null && r.hardnessMaxX10 <= r.hardnessMinX10) out.push("recipe_hardness_max_below_min");
  return out;
}

export type AgeingRecipeSuggestion = AgeingRecipeNumbers & { alloy: string; temper: string; kind: AgeingRecipeKind; hardnessMethod: HardnessMethod };

const suggest = (alloy: string, temper: string, kind: AgeingRecipeKind, c: number, soakMin: number, websterMin: number): AgeingRecipeSuggestion => ({
  alloy,
  temper,
  kind,
  targetTempX10: c * 10,
  toleranceX10: AGEING_TOLERANCE_DEFAULT_X10,
  soakMin,
  maxSoakMin: null,
  hardnessMethod: "webster",
  hardnessMinX10: websterMin * 10,
  // Webster 15.0 warns on 6063; 6061's minimum is already 15.0, so it gets no warning line.
  hardnessMaxX10: websterMin * 10 < 150 ? 150 : null,
  sampleCount: AGEING_SAMPLE_COUNT_DEFAULT,
});

/**
 * Spec §3 suggested drafts (Q1, Q12): saved as drafts only, never published by the system. Not a claim
 * that FourCubes signed these numbers. The calls are marked pure (W3-AG-S review I3) so a web chunk that
 * imports `@orrn/domain` without this list (the `/` entry) drops it.
 */
export const AGEING_RECIPE_SUGGESTIONS: readonly AgeingRecipeSuggestion[] = [
  /* @__PURE__ */ suggest("6063", "T5", "full", 185, 240, 8),
  /* @__PURE__ */ suggest("6063", "T6", "full", 185, 360, 10),
  /* @__PURE__ */ suggest("6061", "T6", "full", 175, 480, 15),
  /* @__PURE__ */ suggest("6063", "T5", "top_up", 185, 60, 8),
  /* @__PURE__ */ suggest("6063", "T6", "top_up", 185, 60, 10),
  /* @__PURE__ */ suggest("6061", "T6", "top_up", 175, 60, 15),
];

/** Dev seed: one oven (active), no trolley in use, two recipes (6063 T5 / T6 full, active). */
export const AGEING_OVEN_SEED = { code: "OV-1", name: "Ageing oven 1", capacityG: 2_000_000, maxTempX10: 2500, meterUnit: "m3" } as const;

// ---------------------------------------------------------------------------
// OVEN_SIMULATOR curve (dev only; the server lane posts it as source `simulator`)
// ---------------------------------------------------------------------------

export const OVEN_CURVE_PROFILES = ["normal", "under", "over", "dip"] as const;
export type OvenCurveProfile = (typeof OVEN_CURVE_PROFILES)[number];

export type OvenCurveInput = {
  targetTempX10: number;
  toleranceX10: number;
  soakMin: number;
  /** Batch in_at (ms). */
  startMs: number;
  /** Minutes between readings (default 15). */
  stepMin?: number;
  /** Oven temperature at the door close (default 35.0 °C). */
  ambientX10?: number;
  /** Minutes to reach the band (default 45). */
  rampMin?: number;
  /** `normal` meets the soak; `under` stops at 60 %; `over` runs 5 °C above the band for 30 min; `dip` drops below it for 45 min. */
  profile?: OvenCurveProfile;
  /** Jitter seed (batch id); the same seed gives the same curve. */
  seed?: string;
};

function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mix(n: number): number {
  let x = (n + 0x9e3779b9) | 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

/** Minutes of the whole curve for a profile (the simulator stops posting after it). */
export function ovenCurveLengthMin(input: Pick<OvenCurveInput, "soakMin" | "rampMin" | "profile">): number {
  const ramp = input.rampMin ?? 45;
  const p = input.profile ?? "normal";
  if (p === "under") return ramp + Math.floor(input.soakMin * 0.6);
  if (p === "dip") return ramp + input.soakMin + 15;
  return ramp + input.soakMin + 30;
}

/** The simulated oven temperature (×10) `minute` minutes after in_at. Deterministic. */
export function ovenSimulatedTempAt(input: OvenCurveInput, minute: number): number {
  const ramp = Math.max(1, input.rampMin ?? 45);
  const ambient = input.ambientX10 ?? 350;
  const p = input.profile ?? "normal";
  const jitterSpan = Math.max(1, Math.floor(input.toleranceX10 / 3));
  const jitter = (mix(hashSeed(input.seed ?? "oven") + Math.floor(minute)) % (2 * jitterSpan + 1)) - jitterSpan;
  if (minute < ramp) {
    // Approach: 95 % of the way by the end of the ramp, never inside the band before it.
    const f = minute / ramp;
    const t = ambient + (input.targetTempX10 - input.toleranceX10 - 10 - ambient) * f;
    return Math.round(t);
  }
  const soakAt = minute - ramp;
  const mid = Math.floor(input.soakMin / 2);
  if (p === "over" && soakAt >= mid && soakAt < mid + 30) return input.targetTempX10 + input.toleranceX10 + 50;
  if (p === "dip" && soakAt >= mid && soakAt < mid + 45) return input.targetTempX10 - input.toleranceX10 - 80;
  return input.targetTempX10 + jitter;
}

/** Readings every `stepMin` from in_at to the end of the profile (inclusive), as the simulator posts them. */
export function ovenSimulatedCurve(input: OvenCurveInput): AgeingReading[] {
  const step = Math.max(1, input.stepMin ?? 15);
  const len = ovenCurveLengthMin(input);
  const out: AgeingReading[] = [];
  for (let m = 0; m <= len; m += step) out.push({ at: input.startMs + m * MIN_MS, tempCX10: ovenSimulatedTempAt(input, m) });
  return out;
}
