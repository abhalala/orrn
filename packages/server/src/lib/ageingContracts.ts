/**
 * Ageing contracts (W3-AG-C): the zod inputs every ageing procedure takes and the shapes it answers
 * with. The router (`routers/ageing.ts`, W3-AG-S) imports these; web and native import the types
 * from `@orrn/server/lib/ageingContracts`. Integer units only (×10 temperatures and hardness, grams,
 * millimetres, thousandths of the gas meter, epoch ms for times). Limits come from `@orrn/domain`.
 *
 * Procedure → input → permission (owner holds all; module gate `ageing`):
 *   ageing.ovens.list/get, trolleys.list/get, recipes.list/get  → idInput / masterListInput   ageing.view | masters.draft
 *   ageing.ovens.save          → ageingOvenSaveInput            masters.draft (draft) / masters.publish (active, out_of_service)
 *   ageing.trolleys.save       → trolleySaveInput               same
 *   ageing.recipes.save        → ageingRecipeSaveInput          same (an active recipe's numbers are never edited in place)
 *   ageing.recipes.suggest     → (none)                         masters.draft   (returns AGEING_RECIPE_SUGGESTIONS, writes nothing)
 *   ageing.batches.list        → ageingListInput                ageing.view
 *   ageing.batches.get         → idInput                        ageing.view
 *   ageing.batches.availableLines   → ageingAvailableLinesInput   ageing.load
 *   ageing.batches.availableBundles → ageingAvailableBundlesInput ageing.load
 *   ageing.batches.load        → ageingLoadInput                ageing.load
 *   ageing.batches.start       → ageingStartInput               ageing.load
 *   ageing.batches.temp        → ageingTempInput                ageing.record
 *   ageing.batches.out         → ageingOutInput                 ageing.load
 *   ageing.batches.hardness    → ageingHardnessInput            ageing.record
 *   ageing.batches.release     → idInput (batchId)              ageing.release
 *   ageing.batches.requestOverride → ageingOverrideRequestInput ageing.release (approval kind ageing_override)
 *   ageing.batches.hold        → ageingHoldInput                ageing.release (a QC hold is the supervisor's; review m8, decision kept)
 *   ageing.batches.unhold      → ageingUnholdInput              ageing.release (clears a hand hold, AG-11)
 *   ageing.batches.rework      → ageingReworkInput              ageing.release
 *   ageing.batches.discardRemaining → ageingDiscardRemainingInput ageing.release (pack calls the lib helper inside its own batch)
 *   ageing.batches.split       → ageingSplitInput               ageing.release (setting ageing.split)
 *   ageing.batches.void        → ageingVoidInput                ageing.load while loading; ageing.release after take-out
 *   ageing.batches.simulate    → ageingSimulateInput            ageing.record, and only when OVEN_SIMULATOR=1 and not production (lib/ageingSimulator.ts)
 *   ageing.packSource          → ageingPackSourceInput          bundle.pack | ageing.view (released rows with pieces left)
 *   ageing.bundleTrace         → ageingBundleTraceInput         any member (the batch, press run and cast behind a bundle, AG-13)
 *   ageing.forOrder            → ageingForOrderInput            order.manage | ageing.view | reports.read
 *   reports.ageing             → ageingReportInput              reports.read
 *   collector (FP-AG-17)       → { instance_id, batch_id, device_id?, readings: [{ at, temp_c_x10 }] }
 *                                (lib/ageingCollector.ts)       POST /collector/ageing/readings, node-signed, source `telemetry`
 *
 * Inserts of loads and feeds go through `pushChunkedInserts` with every column named (≤ 100 bound
 * parameters; 40 rows × ~20 columns and 50 readings × 9 columns are both above it).
 */
import { z } from "zod";

import {
  AGEING_BATCH_STATUSES,
  AGEING_CODE_MAX,
  AGEING_GAS_MAX_MILLI,
  AGEING_HARDNESS_MAX_X10,
  AGEING_HARDNESS_READINGS_MAX,
  AGEING_LOAD_MAX_ROWS,
  AGEING_MASTER_STATUSES,
  AGEING_NOTE_MAX,
  AGEING_PHASES,
  AGEING_QC_VERDICTS,
  AGEING_READINGS_MAX,
  AGEING_RECIPE_KINDS,
  AGEING_RECIPE_STATUSES,
  AGEING_ROW_SOURCES,
  AGEING_ROW_STATUSES,
  AGEING_SAMPLE_COUNT_DEFAULT,
  AGEING_SAMPLE_COUNT_MAX,
  AGEING_SOAK_MAX_MIN,
  AGEING_SOAK_VERDICTS,
  AGEING_SPLIT_CUTS_MAX,
  AGEING_TEMP_MAX_X10,
  AGEING_TEMP_MIN_X10,
  AGEING_TEMP_SOURCES,
  AGEING_TOLERANCE_DEFAULT_X10,
  AGEING_TOLERANCE_MAX_X10,
  BUNDLE_AGEING_STATES,
  HARDNESS_METHODS,
  OVEN_CURVE_PROFILES,
} from "@orrn/domain";

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1).max(64);
const note = z.string().trim().max(AGEING_NOTE_MAX);
const code = z.string().trim().min(1).max(AGEING_CODE_MAX);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const epochMs = z.number().int().min(0);
const pcs = z.number().int().min(1).max(100_000);
const grams = z.number().int().min(0).max(100_000_000);
const lengthMm = z.number().int().min(1).max(30_000);
export const ageingTempX10 = z.number().int().min(AGEING_TEMP_MIN_X10).max(AGEING_TEMP_MAX_X10);
export const ageingHardnessX10 = z.number().int().min(0).max(AGEING_HARDNESS_MAX_X10);
const gasMilli = z.number().int().min(0).max(AGEING_GAS_MAX_MILLI);
const clientMutationId = z.string().trim().min(1).max(64);
const page = { limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).default(0) };

export const ageingMasterStatus = z.enum(AGEING_MASTER_STATUSES);
export const ageingRecipeKind = z.enum(AGEING_RECIPE_KINDS);
export const ageingRecipeStatus = z.enum(AGEING_RECIPE_STATUSES);
export const hardnessMethod = z.enum(HARDNESS_METHODS);
export const ageingBatchStatus = z.enum(AGEING_BATCH_STATUSES);
export const ageingPhase = z.enum(AGEING_PHASES);
export const ageingRowStatus = z.enum(AGEING_ROW_STATUSES);
export const ageingRowSource = z.enum(AGEING_ROW_SOURCES);
export const ageingTempSource = z.enum(AGEING_TEMP_SOURCES);
export const ageingSoakVerdict = z.enum(AGEING_SOAK_VERDICTS);
export const ageingQcVerdict = z.enum(AGEING_QC_VERDICTS);
export const bundleAgeingState = z.enum(BUNDLE_AGEING_STATES);

export const idInput = z.object({ id });
export const masterListInput = z.object({ includeInactive: z.boolean().default(false) }).default({ includeInactive: false });

// ---------------------------------------------------------------------------
// Masters (FP-AG-01..03)
// ---------------------------------------------------------------------------

export const ageingOvenSaveInput = z.object({
  id: id.optional(),
  code,
  name: z.string().trim().max(60).nullable().optional(),
  capacityG: grams.nullable().optional(),
  maxTempX10: ageingTempX10.nullable().optional(),
  meterUnit: z.string().trim().min(1).max(8).default("m3"),
  status: ageingMasterStatus.default("draft"),
  note: note.nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const trolleySaveInput = z.object({
  id: id.optional(),
  code,
  capacityG: grams.nullable().optional(),
  status: ageingMasterStatus.default("draft"),
  note: note.nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});

export const ageingRecipeSaveInput = z.object({
  id: id.optional(),
  alloy: z.string().trim().min(1).max(16),
  temper: z.string().trim().min(1).max(8),
  kind: ageingRecipeKind.default("full"),
  targetTempX10: ageingTempX10,
  toleranceX10: z.number().int().min(1).max(AGEING_TOLERANCE_MAX_X10).default(AGEING_TOLERANCE_DEFAULT_X10),
  soakMin: z.number().int().min(1).max(AGEING_SOAK_MAX_MIN),
  maxSoakMin: z.number().int().min(1).max(AGEING_SOAK_MAX_MIN).nullable().optional(),
  hardnessMethod: hardnessMethod.default("webster"),
  hardnessMinX10: ageingHardnessX10,
  hardnessMaxX10: ageingHardnessX10.nullable().optional(),
  sampleCount: z.number().int().min(1).max(AGEING_SAMPLE_COUNT_MAX).default(AGEING_SAMPLE_COUNT_DEFAULT),
  status: ageingRecipeStatus.default("draft"),
  note: note.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Board, load, cycle
// ---------------------------------------------------------------------------

export const ageingListInput = z.object({
  /** A stored status or a board phase (heating / soaking split in_oven). */
  status: z.union([ageingBatchStatus, ageingPhase]).optional(),
  ovenId: id.optional(),
  trolleyId: id.optional(),
  shiftId: id.optional(),
  from: day.optional(),
  to: day.optional(),
  ...page,
});

export const ageingAvailableLinesInput = z.object({ dieId: id.optional(), castId: id.optional(), recipeId: id.optional(), ...page });
export const ageingAvailableBundlesInput = z.object({ dieId: id.optional(), castId: id.optional(), recipeId: id.optional(), search: z.string().trim().max(40).optional(), ...page });

export const ageingLoadPressRow = z.object({ pressRunLineId: id, pcs, salesOrderLineId: id.optional() });
export const ageingLoadManualRow = z.object({
  dieId: id,
  dieInstanceId: id.optional(),
  lengthMm,
  pcs,
  kgG: grams,
  castId: id.optional(),
  salesOrderLineId: id.optional(),
  customerPo: z.string().trim().max(40).optional(),
});
export const ageingLoadBundleRow = z.object({ bundleId: id });

/**
 * Create the batch (`AG-{seq}`) on a trolley with no unfinished batch, or add rows to its batch
 * while it is `loading`. At least one row in total, at most AGEING_LOAD_MAX_ROWS.
 */
export const ageingLoadInput = z
  .object({
    batchId: id.optional(),
    trolleyId: id,
    recipeId: id.optional(),
    rows: z.array(ageingLoadPressRow).max(AGEING_LOAD_MAX_ROWS).default([]),
    manual: z.array(ageingLoadManualRow).max(AGEING_LOAD_MAX_ROWS).default([]),
    bundles: z.array(ageingLoadBundleRow).max(AGEING_LOAD_MAX_ROWS).default([]),
    clientMutationId: clientMutationId.optional(),
  })
  .refine((v) => v.rows.length + v.manual.length + v.bundles.length >= 1, { message: "Load at least one line", path: ["rows"] })
  .refine((v) => v.rows.length + v.manual.length + v.bundles.length <= AGEING_LOAD_MAX_ROWS, {
    message: `Load at most ${AGEING_LOAD_MAX_ROWS} lines at a time`,
    path: ["rows"],
  });

export const ageingStartInput = z.object({
  batchId: id,
  ovenId: id,
  recipeId: id,
  shiftId: id,
  gasStartMilli: gasMilli,
  /** The gas meter was replaced: a start below the oven's last end is then not a warning. */
  meterReset: z.boolean().default(false),
  /** Default server now; back at most 12 hours; never ahead. */
  inAt: epochMs.optional(),
  clientMutationId: clientMutationId.optional(),
});

export const ageingTempInput = z.object({
  batchId: id,
  tempCX10: ageingTempX10,
  at: epochMs.optional(),
  note: note.optional(),
  clientMutationId: clientMutationId.optional(),
});

/** A collector node (FP-AG-17) or the dev simulator: many readings, idempotent on (batch, source, at). */
export const ageingTelemetryInput = z.object({
  batchId: id,
  source: z.enum(["telemetry", "simulator"]),
  /** The collector's probe / channel (FP-AG-17); readings of two devices at the same ms are two rows. */
  deviceId: z.string().trim().max(64).default(""),
  readings: z.array(z.object({ at: epochMs, tempCX10: ageingTempX10 })).min(1).max(AGEING_READINGS_MAX),
});

export const ageingOutInput = z.object({
  batchId: id,
  gasEndMilli: gasMilli,
  outAt: epochMs.optional(),
  clientMutationId: clientMutationId.optional(),
});

export const ageingHardnessInput = z.object({
  rowId: id,
  method: hardnessMethod,
  readingsX10: z.array(ageingHardnessX10).min(1).max(AGEING_HARDNESS_READINGS_MAX),
  clientMutationId: clientMutationId.optional(),
});

export const ageingBatchIdInput = z.object({ batchId: id });

export const ageingOverrideRequestInput = z.object({ batchId: id, reason: z.string().trim().min(1).max(AGEING_NOTE_MAX) });

/** Clear a hand hold (AG-11, review I5). */
export const ageingUnholdInput = z.object({ rowId: id, note: note.optional() });

export const ageingHoldInput = z
  .object({ batchId: id.optional(), rowId: id.optional(), reasonCodeId: id, note: note.optional() })
  .refine((v) => (v.batchId ? 1 : 0) + (v.rowId ? 1 : 0) === 1, { message: "Hold a trolley or one line", path: ["rowId"] });

export const ageingReworkInput = z.object({ batchId: id, recipeId: id.optional(), trolleyId: id.optional() });

export const ageingDiscardRemainingInput = z.object({ rowId: id, pcs, reasonCodeId: id, note: note.optional() });

export const ageingSplitInput = z.object({
  rowId: id,
  cuts: z.array(z.object({ lengthMm, pcs })).min(2).max(AGEING_SPLIT_CUTS_MAX),
});

/** Abort: an `ageing_abort` reason code; required once the batch has been in the oven. */
export const ageingVoidInput = z.object({ batchId: id, reasonCodeId: id.optional(), reason: note.optional() });

export const ageingSimulateInput = z.object({ batchId: id, profile: z.enum(OVEN_CURVE_PROFILES).default("normal") });

export const ageingForOrderInput = z.object({ salesOrderId: id });
export const ageingPackSourceInput = z.object({ dieId: id.optional(), salesOrderLineId: id.optional(), ...page });
export const ageingBundleTraceInput = z.object({ bundleId: id });

export const ageingReportInput = z
  .object({
  from: day,
  to: day,
  shiftId: id.optional(),
  ovenId: id.optional(),
  dieId: id.optional(),
  customerId: id.optional(),
  castId: id.optional(),
  status: ageingBatchStatus.optional(),
  format: z.enum(["json", "csv"]).default("json"),
  ...page,
  })
  // Review m12.
  .refine((v) => v.from <= v.to, { message: "From must be on or before to", path: ["to"] });

/** `company.updateSettings` part for ageing (settings.update). */
export const ageingSettingsInput = z.object({
  manualLoad: z.boolean().optional(),
  split: z.boolean().optional(),
  requireForPack: z.boolean().optional(),
  requireAgeing: z.boolean().optional(),
  requireAgeingSince: day.nullable().optional(),
});

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

const ts = z.number().int().nullable();

export const ageingRecipeSnapshot = z.object({
  alloy: z.string(),
  temper: z.string(),
  targetTempX10: z.number().int(),
  toleranceX10: z.number().int(),
  soakMin: z.number().int(),
  maxSoakMin: z.number().int().nullable(),
  hardnessMethod,
  hardnessMinX10: z.number().int(),
  hardnessMaxX10: z.number().int().nullable(),
  sampleCount: z.number().int(),
});

export const ageingRowView = z.object({
  id: z.string(),
  batchId: z.string(),
  source: ageingRowSource,
  status: ageingRowStatus,
  pressRunId: z.string().nullable(),
  pressRunNumber: z.string().nullable(),
  pressRunLineId: z.string().nullable(),
  bundleId: z.string().nullable(),
  bundleSerial: z.string().nullable(),
  dieId: z.string(),
  sectionLabel: z.string(),
  dieInstanceId: z.string().nullable(),
  dieInstanceCode: z.string().nullable(),
  castId: z.string().nullable(),
  castCode: z.string().nullable(),
  salesOrderId: z.string().nullable(),
  salesOrderLineId: z.string().nullable(),
  salesOrderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPo: z.string().nullable(),
  lengthMm: z.number().int(),
  pcs: z.number().int(),
  kgG: z.number().int(),
  packedPcs: z.number().int(),
  scrapPcs: z.number().int(),
  reworkPcs: z.number().int(),
  /** Server remaining; clients never subtract columns. */
  remainingPcs: z.number().int(),
  theoreticalRemainingKgG: z.number().int(),
  holdReasonCodeId: z.string().nullable(),
  holdNote: z.string().nullable(),
  hardnessMethod: hardnessMethod.nullable(),
  hardnessReadingX10: z.number().int().nullable(),
  hardnessPass: z.boolean().nullable(),
});

export const ageingTempReadingView = z.object({ id: z.string(), at: z.number().int(), tempCX10: z.number().int(), source: ageingTempSource, note: z.string().nullable(), inBand: z.boolean() });
/** `pass` is null for a sample of the other method (not deciding, review m4). */
export const ageingHardnessView = z.object({ id: z.string(), rowId: z.string(), method: hardnessMethod, readingX10: z.number().int(), pass: z.boolean().nullable(), testedAt: z.number().int() });

export const ageingBatchTotalsView = z.object({
  loadedPcs: z.number().int(),
  packedPcs: z.number().int(),
  scrapPcs: z.number().int(),
  reworkPcs: z.number().int(),
  remainingPcs: z.number().int(),
  packablePcs: z.number().int(),
  heldPcs: z.number().int(),
  pendingPcs: z.number().int(),
  loadedKgG: z.number().int(),
  theoreticalRemainingKgG: z.number().int(),
});

export const ageingSoakView = z.object({
  verdict: ageingSoakVerdict,
  soakStartedAt: ts,
  inBandMin: z.number().int(),
  aboveBandMin: z.number().int(),
  belowBandMin: z.number().int(),
  /** Minutes no reading stands for (a reading holds at most AGEING_READING_HOLD_MAX_MIN). */
  unknownMin: z.number().int(),
  soakElapsedMin: z.number().int(),
  minX10: z.number().int().nullable(),
  maxX10: z.number().int().nullable(),
  readingCount: z.number().int(),
  met: z.boolean(),
});

/** One board card / list row. */
export const ageingBatchSummary = z.object({
  id: z.string(),
  number: z.string(),
  status: ageingBatchStatus,
  phase: ageingPhase,
  trolleyId: z.string(),
  trolleyCode: z.string(),
  ovenId: z.string().nullable(),
  ovenCode: z.string().nullable(),
  recipeLabel: z.string().nullable(),
  shiftId: z.string().nullable(),
  productionDay: z.string().nullable(),
  inAt: ts,
  outAt: ts,
  soakStartedAt: ts,
  soakMin: z.number().int().nullable(),
  lastTempCX10: z.number().int().nullable(),
  capacity: z.enum(["ok", "near", "over", "unknown"]),
  totals: ageingBatchTotalsView,
});

export const ageingBatchDetail = ageingBatchSummary.extend({
  snapshot: ageingRecipeSnapshot.nullable(),
  gasStartMilli: z.number().int().nullable(),
  gasEndMilli: z.number().int().nullable(),
  gasUsedMilli: z.number().int().nullable(),
  meterReset: z.boolean(),
  soak: ageingSoakView.nullable(),
  qcVerdict: ageingQcVerdict.nullable(),
  releasedAt: ts,
  overrideApprovalId: z.string().nullable(),
  /** A pending ageing_override request for this batch, if any. */
  pendingOverrideId: z.string().nullable(),
  reworkOfBatchId: z.string().nullable(),
  successorBatchId: z.string().nullable(),
  disposition: z.enum(["rework", "scrapped"]).nullable(),
  voidReason: z.string().nullable(),
  rows: z.array(ageingRowView),
  readings: z.array(ageingTempReadingView),
  hardness: z.array(ageingHardnessView),
  /** Set when OVEN_SIMULATOR is on locally: the readings may come from the simulator. */
  simulator: z.boolean(),
});

/** `ageing.batches.availableLines`: logged press-run lines with pieces still to load. */
export const ageingAvailableLine = z.object({
  pressRunLineId: z.string(),
  pressRunId: z.string(),
  pressRunNumber: z.string(),
  dieId: z.string(),
  sectionLabel: z.string(),
  dieInstanceId: z.string().nullable(),
  dieInstanceCode: z.string().nullable(),
  castId: z.string().nullable(),
  castCode: z.string().nullable(),
  alloy: z.string().nullable(),
  temper: z.string().nullable(),
  lengthMm: z.number().int(),
  pcsLeft: z.number().int(),
  kgLeftG: z.number().int(),
  salesOrderLineId: z.string().nullable(),
  salesOrderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
});

/** Pack's source step (spec §5): released rows with remaining > 0. Pack's own query, this shape. */
export const ageingPackSourceRow = z.object({
  ageingRowId: z.string(),
  trolleyCode: z.string(),
  batchNumber: z.string(),
  dieInstanceCode: z.string().nullable(),
  sectionLabel: z.string(),
  cutLengthMm: z.number().int(),
  remainingPcs: z.number().int(),
  salesOrderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  castCode: z.string().nullable(),
});

/** `ageing.forOrder` per sales-order line: pieces and theoretical kg (FP-AG-15). */
export const ageingForOrderLine = z.object({
  salesOrderLineId: z.string(),
  /**
   * Theoretical grams still on trolleys for the line (every live row's kg_g prorated by its remaining
   * pieces: in the oven, out, held or released and not yet packed). The order strip's `agedG` is this
   * figure, and `pressedG = max(0, logged − aged − produced)` (AG-15, review I7).
   */
  agedG: z.number().int(),
  loadedPcs: z.number().int(),
  loadedKgG: z.number().int(),
  inOvenPcs: z.number().int(),
  outUntestedPcs: z.number().int(),
  heldPcs: z.number().int(),
  releasedPcs: z.number().int(),
  packedPcs: z.number().int(),
  remainingPcs: z.number().int(),
});

/** `reports.ageing`: one row per ageing row (spec §5 column order). */
export const ageingReportRow = z.object({
  batchNumber: z.string(),
  ovenCode: z.string().nullable(),
  trolleyCode: z.string(),
  shiftName: z.string().nullable(),
  inAt: ts,
  outAt: ts,
  soakMin: z.number().int().nullable(),
  recipeSoakMin: z.number().int().nullable(),
  setTempCX10: z.number().int().nullable(),
  actualMinX10: z.number().int().nullable(),
  actualMaxX10: z.number().int().nullable(),
  pressRunNumber: z.string().nullable(),
  salesOrderNumber: z.string().nullable(),
  customerName: z.string().nullable(),
  customerPo: z.string().nullable(),
  castCode: z.string().nullable(),
  dieInstanceCode: z.string().nullable(),
  sectionLabel: z.string(),
  lengthMm: z.number().int(),
  loadedPcs: z.number().int(),
  /** packed_pcs: bundles plus pack-time rejects. */
  takenByPackPcs: z.number().int(),
  onBundlesPcs: z.number().int(),
  remainingPcs: z.number().int(),
  held: z.boolean(),
  source: ageingRowSource,
  hardnessMethod: hardnessMethod.nullable(),
  sampleCount: z.number().int(),
  medianX10: z.number().int().nullable(),
  pass: z.boolean().nullable(),
});

export type AgeingOvenSaveInput = z.infer<typeof ageingOvenSaveInput>;
export type TrolleySaveInput = z.infer<typeof trolleySaveInput>;
export type AgeingRecipeSaveInput = z.infer<typeof ageingRecipeSaveInput>;
export type AgeingListInput = z.infer<typeof ageingListInput>;
export type AgeingLoadInput = z.infer<typeof ageingLoadInput>;
export type AgeingStartInput = z.infer<typeof ageingStartInput>;
export type AgeingTempInput = z.infer<typeof ageingTempInput>;
export type AgeingTelemetryInput = z.infer<typeof ageingTelemetryInput>;
export type AgeingOutInput = z.infer<typeof ageingOutInput>;
export type AgeingHardnessInput = z.infer<typeof ageingHardnessInput>;
export type AgeingHoldInput = z.infer<typeof ageingHoldInput>;
export type AgeingReworkInput = z.infer<typeof ageingReworkInput>;
export type AgeingDiscardRemainingInput = z.infer<typeof ageingDiscardRemainingInput>;
export type AgeingSplitInput = z.infer<typeof ageingSplitInput>;
export type AgeingVoidInput = z.infer<typeof ageingVoidInput>;
export type AgeingReportInput = z.infer<typeof ageingReportInput>;
export type AgeingSettingsInput = z.infer<typeof ageingSettingsInput>;
export type AgeingRowView = z.infer<typeof ageingRowView>;
export type AgeingBatchSummary = z.infer<typeof ageingBatchSummary>;
export type AgeingBatchDetail = z.infer<typeof ageingBatchDetail>;
export type AgeingAvailableLine = z.infer<typeof ageingAvailableLine>;
export type AgeingPackSourceRow = z.infer<typeof ageingPackSourceRow>;
export type AgeingForOrderLine = z.infer<typeof ageingForOrderLine>;

/** AG-13: what stands behind a bundle (`ageing.bundleTrace`). Null fields when the bundle never met a trolley. */
export const ageingBundleTrace = z.object({
  bundleId: z.string(),
  state: bundleAgeingState,
  ageingRowId: z.string().nullable(),
  batchId: z.string().nullable(),
  batchNumber: z.string().nullable(),
  trolleyCode: z.string().nullable(),
  ovenCode: z.string().nullable(),
  recipeLabel: z.string().nullable(),
  inAt: ts,
  outAt: ts,
  releasedAt: ts,
  qcVerdict: ageingQcVerdict.nullable(),
  hardnessMethod: hardnessMethod.nullable(),
  hardnessReadingX10: z.number().int().nullable(),
  pressRunId: z.string().nullable(),
  pressRunNumber: z.string().nullable(),
  castId: z.string().nullable(),
  castCode: z.string().nullable(),
});
export type AgeingBundleTrace = z.infer<typeof ageingBundleTrace>;
export type AgeingUnholdInput = z.infer<typeof ageingUnholdInput>;
export type AgeingReportRow = z.infer<typeof ageingReportRow>;
