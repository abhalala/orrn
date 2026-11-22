/**
 * Quality gates (XE parity lane QA, rows 22 to 29 and 35 to 39). orrn models quality as about seven
 * checkpoints on documents it already has (press run, bundle, scrap lot, cast, ageing batch), not as
 * separate registers: every check is one `qa_check` row of a kind, and each register is a filtered list
 * of those rows. Pure rules live here; the server computes every verdict and flag, clients never send one.
 *
 * Units (integers only):
 * - dimensions in micrometres (1.20 mm = 1200 um);
 * - tensile and yield in MPa; elongation and hardness x10 (`125` = 12.5 %, `800` = 80.0 HW);
 * - press readings x10 like the collector (`4800` = 480.0 C, ram speed 0.1 mm/s);
 * - calendar days as company-day text `YYYY-MM-DD`.
 */

/** The checkpoint kinds. Each register is a list of one kind (rows 22 to 27 and 39). */
export const QA_CHECK_KINDS = ["incoming", "first_piece", "in_process", "clearance", "dimension", "mechanical", "ultrasonic"] as const;
export type QaCheckKind = (typeof QA_CHECK_KINDS)[number];

/** What a check is about. `store_grn` is bought-in material received in the central store. */
export const QA_SUBJECT_TYPES = ["press_run", "bundle", "purchase_lot", "store_grn", "cast", "ageing_batch"] as const;
export type QaSubjectType = (typeof QA_SUBJECT_TYPES)[number];

/** Which subjects each kind may be recorded on (the server refuses any other pair). */
export const QA_KIND_SUBJECTS: Record<QaCheckKind, readonly QaSubjectType[]> = {
  incoming: ["purchase_lot", "store_grn"],
  first_piece: ["press_run"],
  in_process: ["press_run"],
  clearance: ["press_run", "purchase_lot", "ageing_batch", "cast"],
  dimension: ["press_run", "bundle", "ageing_batch"],
  mechanical: ["press_run", "bundle", "ageing_batch", "cast"],
  ultrasonic: ["bundle", "cast", "purchase_lot"],
};

export function kindAllowsSubject(kind: QaCheckKind, subject: QaSubjectType): boolean {
  return QA_KIND_SUBJECTS[kind].includes(subject);
}

/** Stages a lot or run waits at, and the next stage a clearance lets it go to (rows 23 and 36). */
export const QA_STAGES = ["incoming", "press", "ageing", "pack", "dispatch"] as const;
export type QaStage = (typeof QA_STAGES)[number];

export const QA_RESULTS = ["pass", "fail"] as const;
export type QaResult = (typeof QA_RESULTS)[number];

// ---------------------------------------------------------------------------
// Plant settings (`company.settings.qa`)
// ---------------------------------------------------------------------------

export type QaSettings = {
  /** Row 24: packing from a run waits until its first piece passes. Default off. */
  firstPieceBlocksPack: boolean;
  /** Company day the switch went on; runs started before it are exempt. */
  firstPieceSince: string | null;
  /** Row 39: an in-process check is due every N bundles packed from a run (null = no count rule). */
  inProcessEveryBundles: number | null;
  /** Row 39: an in-process check is due every N minutes of a running run (null = no time rule). */
  inProcessEveryMinutes: number | null;
  /**
   * Row 22: a lot that is waiting for inspection or failed it cannot be charged to a melt. Default on
   * for new plants (written when the plant is made), off for plants that existed before the lane.
   */
  requireLotInspection: boolean;
  /** Company day the switch went on; lots received before it are exempt. */
  lotInspectionSince: string | null;
};

export const QA_SETTINGS_DEFAULTS: QaSettings = {
  firstPieceBlocksPack: false,
  firstPieceSince: null,
  inProcessEveryBundles: null,
  inProcessEveryMinutes: null,
  requireLotInspection: false,
  lotInspectionSince: null,
};

/** Upper bounds for the in-process cadence. */
export const QA_EVERY_BUNDLES_MAX = 500;
export const QA_EVERY_MINUTES_MAX = 24 * 60;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const asYmd = (v: unknown): string | null => (typeof v === "string" && YMD.test(v) ? v : null);
const asEvery = (v: unknown, max: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max ? v : null);

/** Read `company.settings.qa`; anything malformed takes its default. */
export function readQaSettings(settings: Record<string, unknown> | null | undefined): QaSettings {
  const q = asObj(asObj(settings).qa);
  const d = QA_SETTINGS_DEFAULTS;
  return {
    firstPieceBlocksPack: typeof q.firstPieceBlocksPack === "boolean" ? q.firstPieceBlocksPack : d.firstPieceBlocksPack,
    firstPieceSince: asYmd(q.firstPieceSince),
    inProcessEveryBundles: asEvery(q.inProcessEveryBundles, QA_EVERY_BUNDLES_MAX),
    inProcessEveryMinutes: asEvery(q.inProcessEveryMinutes, QA_EVERY_MINUTES_MAX),
    requireLotInspection: typeof q.requireLotInspection === "boolean" ? q.requireLotInspection : d.requireLotInspection,
    lotInspectionSince: asYmd(q.lotInspectionSince),
  };
}

/**
 * The settings a new plant starts with: lot inspection on from its first day (row 22). Plants that
 * existed before have no `qa` key and read the default (off).
 */
export function newPlantQaSettings(today: string): Pick<QaSettings, "requireLotInspection" | "lotInspectionSince"> {
  return { requireLotInspection: true, lotInspectionSince: today };
}

/**
 * Merge an edit into the stored settings. Turning a gate on stamps today as its start day (only lots and
 * runs from that day on are gated, so switching on never blocks what was received or pressed earlier);
 * turning it off clears the day.
 */
export function applyQaSettingsEdit(was: QaSettings, edit: Partial<Omit<QaSettings, "firstPieceSince" | "lotInspectionSince">>, today: string): QaSettings {
  const next: QaSettings = { ...was };
  if (edit.firstPieceBlocksPack !== undefined) {
    next.firstPieceBlocksPack = edit.firstPieceBlocksPack;
    next.firstPieceSince = edit.firstPieceBlocksPack ? (was.firstPieceBlocksPack ? (was.firstPieceSince ?? today) : today) : null;
  }
  if (edit.requireLotInspection !== undefined) {
    next.requireLotInspection = edit.requireLotInspection;
    next.lotInspectionSince = edit.requireLotInspection ? (was.requireLotInspection ? (was.lotInspectionSince ?? today) : today) : null;
  }
  if (edit.inProcessEveryBundles !== undefined) next.inProcessEveryBundles = edit.inProcessEveryBundles;
  if (edit.inProcessEveryMinutes !== undefined) next.inProcessEveryMinutes = edit.inProcessEveryMinutes;
  return next;
}

// ---------------------------------------------------------------------------
// Gates (rows 22 and 24)
// ---------------------------------------------------------------------------

/** The latest check of a kind on a subject: `null` when none was recorded. */
export type LatestResult = QaResult | null;

/** What the inspection state of a lot (or a run's first piece) reads as. */
export type InspectionState = "waiting" | "passed" | "failed";

export function inspectionState(latest: LatestResult): InspectionState {
  return latest === "pass" ? "passed" : latest === "fail" ? "failed" : "waiting";
}

/** Row 22: why a lot cannot be charged to a melt, or null when it may. */
export function lotChargeRefusal(o: { required: boolean; since: string | null; receivedDay: string; latest: LatestResult }): "lot_waiting" | "lot_failed" | null {
  if (!o.required) return null;
  if (o.since && o.receivedDay < o.since) return null;
  const state = inspectionState(o.latest);
  return state === "passed" ? null : state === "failed" ? "lot_failed" : "lot_waiting";
}

/**
 * Row 24: why packing from a run must wait, or null when it may. `run` is null when no run on the copy
 * can be named (a pack with no copy, or a copy that never ran under orrn): nothing to gate then.
 */
export function firstPieceRefusal(o: {
  required: boolean;
  since: string | null;
  run: { startedDay: string; latest: LatestResult } | null;
}): "first_piece_waiting" | "first_piece_failed" | null {
  if (!o.required || !o.run) return null;
  if (o.since && o.run.startedDay < o.since) return null;
  const state = inspectionState(o.run.latest);
  return state === "passed" ? null : state === "failed" ? "first_piece_failed" : "first_piece_waiting";
}

// ---------------------------------------------------------------------------
// In-process checks (row 39)
// ---------------------------------------------------------------------------

/**
 * Whether an in-process check is due on a run: N bundles packed since the last check (or since the first
 * piece when none), or N minutes since then. Warning only, never a block.
 */
export function inProcessDue(o: {
  everyBundles: number | null;
  everyMinutes: number | null;
  bundlesSinceLast: number;
  minutesSinceLast: number | null;
}): { due: boolean; reason: "bundles" | "minutes" | null } {
  if (o.everyBundles != null && o.bundlesSinceLast >= o.everyBundles) return { due: true, reason: "bundles" };
  if (o.everyMinutes != null && o.minutesSinceLast != null && o.minutesSinceLast >= o.everyMinutes) return { due: true, reason: "minutes" };
  return { due: false, reason: null };
}

// ---------------------------------------------------------------------------
// Dimensions (row 25)
// ---------------------------------------------------------------------------

/** One critical dimension from the drawing: nominal with its minus and plus tolerance. */
export type DimensionSpec = { name: string; nominalUm: number; minusUm: number; plusUm: number };
export type DimensionReading = DimensionSpec & { measuredUm: number };
export type DimensionRowVerdict = DimensionReading & { deviationUm: number; within: boolean; side: "under" | "over" | null };

export const MAX_DIMENSIONS = 20;
/** 1 m in micrometres: no extrusion dimension is larger. */
export const MAX_DIMENSION_UM = 1_000_000;

/** Pass when every reading sits inside nominal - minus .. nominal + plus; the rest are flagged. */
export function dimensionVerdict(rows: readonly DimensionReading[]): { result: QaResult; rows: DimensionRowVerdict[]; flagged: string[] } {
  const out = rows.map((r) => {
    const deviationUm = r.measuredUm - r.nominalUm;
    const side: DimensionRowVerdict["side"] = deviationUm < -r.minusUm ? "under" : deviationUm > r.plusUm ? "over" : null;
    return { ...r, deviationUm, within: side === null, side };
  });
  const flagged = out.filter((r) => !r.within).map((r) => r.name);
  return { result: rows.length > 0 && flagged.length === 0 ? "pass" : "fail", rows: out, flagged };
}

/** Why a set of dimension readings is not acceptable to store, or null. */
export function dimensionInputError(rows: readonly DimensionReading[]): "none" | "too_many" | "bad_value" | "duplicate" | null {
  if (rows.length === 0) return "none";
  if (rows.length > MAX_DIMENSIONS) return "too_many";
  const names = new Set<string>();
  for (const r of rows) {
    const nums = [r.nominalUm, r.minusUm, r.plusUm, r.measuredUm];
    if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > MAX_DIMENSION_UM) || r.nominalUm === 0) return "bad_value";
    const key = r.name.trim().toLowerCase();
    if (!key || names.has(key)) return key ? "duplicate" : "bad_value";
    names.add(key);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Mechanical properties and the temper master (rows 26 and 35)
// ---------------------------------------------------------------------------

/** Minimums for one temper (T5, T6 ...). Null = no minimum on that property. */
export type TemperLimits = {
  hardnessMinX10: number | null;
  tensileMinMpa: number | null;
  yieldMinMpa: number | null;
  elongationMinX10: number | null;
};

export type MechanicalValues = {
  tensileMpa: number | null;
  yieldMpa: number | null;
  elongationX10: number | null;
  hardnessX10: number | null;
};

export type MechanicalProperty = "tensile" | "yield" | "elongation" | "hardness";

/**
 * Pass when every value that has a minimum meets it. A property with a minimum and no value is `missing`
 * (the check fails until it is entered); a value with no minimum is recorded and never fails.
 */
export function mechanicalVerdict(values: MechanicalValues, limits: TemperLimits | null): { result: QaResult; low: MechanicalProperty[]; missing: MechanicalProperty[] } {
  const pairs: [MechanicalProperty, number | null, number | null][] = [
    ["tensile", values.tensileMpa, limits?.tensileMinMpa ?? null],
    ["yield", values.yieldMpa, limits?.yieldMinMpa ?? null],
    ["elongation", values.elongationX10, limits?.elongationMinX10 ?? null],
    ["hardness", values.hardnessX10, limits?.hardnessMinX10 ?? null],
  ];
  const low: MechanicalProperty[] = [];
  const missing: MechanicalProperty[] = [];
  for (const [name, value, min] of pairs) {
    if (min == null) continue;
    if (value == null) missing.push(name);
    else if (value < min) low.push(name);
  }
  const anyValue = pairs.some(([, v]) => v != null);
  return { result: anyValue && low.length === 0 && missing.length === 0 ? "pass" : "fail", low, missing };
}

/** A temper code: letter T, O, F or H then digits and letters (T6, T651, H14, O). At most 8. */
export function isTemperCode(code: string): boolean {
  return /^[TOFH][0-9A-Z]{0,7}$/.test(code);
}

/** Yield above tensile is a typing slip. */
export function temperLimitsError(l: TemperLimits): "yield_above_tensile" | null {
  return l.tensileMinMpa != null && l.yieldMinMpa != null && l.yieldMinMpa > l.tensileMinMpa ? "yield_above_tensile" : null;
}

// ---------------------------------------------------------------------------
// Quality plan per section (row 28)
// ---------------------------------------------------------------------------

export type ProcessLimits = {
  billetTempMinX10: number | null;
  billetTempMaxX10: number | null;
  exitTempMinX10: number | null;
  exitTempMaxX10: number | null;
  ramSpeedMinX10: number | null;
  ramSpeedMaxX10: number | null;
};

/** What the press collector saw over a run (`press_run_collector`). */
export type RunReadings = {
  billetTempAvgX10: number | null;
  exitTempMaxX10: number | null;
  ramSpeedAvgX10: number | null;
  ramSpeedMaxX10: number | null;
};

export type PlanMetric = "billet_temp" | "exit_temp" | "ram_speed";
export type PlanBreach = { metric: PlanMetric; direction: "low" | "high"; limitX10: number; valueX10: number };

/** Which process limits a run's readings broke (the flag on the run). A missing reading is never a breach. */
export function planBreaches(limits: ProcessLimits, readings: RunReadings): PlanBreach[] {
  const out: PlanBreach[] = [];
  const check = (metric: PlanMetric, lowValue: number | null, highValue: number | null, min: number | null, max: number | null) => {
    if (min != null && lowValue != null && lowValue < min) out.push({ metric, direction: "low", limitX10: min, valueX10: lowValue });
    if (max != null && highValue != null && highValue > max) out.push({ metric, direction: "high", limitX10: max, valueX10: highValue });
  };
  check("billet_temp", readings.billetTempAvgX10, readings.billetTempAvgX10, limits.billetTempMinX10, limits.billetTempMaxX10);
  check("exit_temp", readings.exitTempMaxX10, readings.exitTempMaxX10, limits.exitTempMinX10, limits.exitTempMaxX10);
  check("ram_speed", readings.ramSpeedAvgX10, readings.ramSpeedMaxX10, limits.ramSpeedMinX10, limits.ramSpeedMaxX10);
  return out;
}

/** A min above its max is a typing slip. */
export function processLimitsError(l: ProcessLimits): PlanMetric | null {
  if (l.billetTempMinX10 != null && l.billetTempMaxX10 != null && l.billetTempMinX10 > l.billetTempMaxX10) return "billet_temp";
  if (l.exitTempMinX10 != null && l.exitTempMaxX10 != null && l.exitTempMinX10 > l.exitTempMaxX10) return "exit_temp";
  if (l.ramSpeedMinX10 != null && l.ramSpeedMaxX10 != null && l.ramSpeedMinX10 > l.ramSpeedMaxX10) return "ram_speed";
  return null;
}

// ---------------------------------------------------------------------------
// Alloy substitutes (row 37)
// ---------------------------------------------------------------------------

/** An order line's alloy is short when billets on hand of it are less than the kg still to press. */
export function alloyShort(o: { needG: number; onHandG: number }): boolean {
  return o.needG > 0 && o.onHandG < o.needG;
}

/** Substitutes for an alloy and customer: the customer's own list when it has one, else the plant's. */
export function substitutesFor<T extends { alloy: string; substitute: string; customerId: string | null }>(rows: readonly T[], alloy: string, customerId: string | null): T[] {
  const forAlloy = rows.filter((r) => r.alloy === alloy);
  const own = customerId ? forAlloy.filter((r) => r.customerId === customerId) : [];
  return own.length > 0 ? own : forAlloy.filter((r) => r.customerId == null);
}

// ---------------------------------------------------------------------------
// Instruments and calibration (row 38)
// ---------------------------------------------------------------------------

export const CALIBRATION_SOON_DAYS = 7;
export type CalibrationState = "ok" | "due_soon" | "overdue" | "unknown";

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** `YYYY-MM-DD` plus `days`. */
export function addDays(ymd: string, days: number): string {
  const t = new Date((dayNumber(ymd) + days) * 86_400_000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

/** The next due day from the last calibration and the interval, or null when either is missing. */
export function nextCalibrationDue(lastOn: string | null, intervalDays: number | null): string | null {
  if (!lastOn || !YMD.test(lastOn) || intervalDays == null || intervalDays < 1) return null;
  return addDays(lastOn, intervalDays);
}

/** Overdue once the due day has passed; due soon within `soonDays` of it. */
export function calibrationState(nextDueOn: string | null, today: string, soonDays = CALIBRATION_SOON_DAYS): CalibrationState {
  if (!nextDueOn || !YMD.test(nextDueOn)) return "unknown";
  const left = dayNumber(nextDueOn) - dayNumber(today);
  return left < 0 ? "overdue" : left <= soonDays ? "due_soon" : "ok";
}

// ---------------------------------------------------------------------------
// Refusals
// ---------------------------------------------------------------------------

/** Every refusal a QA procedure or a QA gate in another module may give (`lib/qaRefusals.ts`). */
export const QA_REFUSAL_CODES = [
  "bundle_on_qa_hold",
  "already_on_hold",
  "not_on_hold",
  "bundle_not_in_stock",
  "bundle_on_load",
  "lot_waiting",
  "lot_failed",
  "first_piece_waiting",
  "first_piece_failed",
  "kind_subject",
  "subject_not_found",
  "dimensions_none",
  "dimensions_too_many",
  "dimensions_bad_value",
  "dimensions_duplicate",
  "mechanical_none",
  "result_needed",
  "temper_code",
  "temper_taken",
  "temper_yield",
  "plan_limits",
  "plan_copy_section",
  "station_taken",
  "station_code",
  "substitute_same",
  "substitute_taken",
  "instrument_taken",
  "instrument_code",
  "calibration_future",
  "certificate_kind",
] as const;
export type QaRefusalCode = (typeof QA_REFUSAL_CODES)[number];
