/**
 * Pure view models for the ageing screens (FP-AG, W3-AG-W): the stage stepper, the one action a batch
 * allows, the soak and capacity wording, the temperature sparkline, the load picker's arithmetic and
 * the typed numbers (temperature and hardness are x10 integers on the wire). No React here, so it is
 * unit-tested directly. Every verdict (soak, hardness, release plan, remaining pieces, totals) is the
 * server's; nothing here decides one.
 */
import type { StatusTone } from "@orrn/domain";
import { parseDecimal } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import type { AgeingBatchDetail, AgeingBatchSummary, AgeingRowView } from "@orrn/server/lib/ageingContracts";

export type BatchLike = Pick<AgeingBatchSummary, "status" | "phase">;

// ---------------------------------------------------------------------------
// Typed and shown numbers
// ---------------------------------------------------------------------------

/** 1850 -> "185.0" (degrees C or hardness, stored x10). */
export function x10Text(x10: number | null | undefined): string {
  return x10 === null || x10 === undefined ? "-" : (x10 / 10).toFixed(1);
}

/** "185" / "185.5" -> 1855-style x10, or null for blank, not a number or more than one decimal. */
export function x10FromText(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || !(n >= 0)) return null;
  const x10 = Math.round(n * 10);
  return Math.abs(x10 - n * 10) < 1e-6 ? x10 : null;
}

/** Typed whole number (pieces, minutes), or null. */
export function wholeFromText(text: string): number | null {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** The gas meter in thousandths of a unit: "1209.350" <-> 1209350. */
export function gasText(milli: number | null | undefined): string {
  return milli === null || milli === undefined ? "-" : (milli / 1000).toFixed(3);
}

export function gasFromText(text: string): number | null {
  const n = parseDecimal(text);
  if (n === null || !(n >= 0)) return null;
  const milli = Math.round(n * 1000);
  return Math.abs(milli - n * 1000) < 1e-6 ? milli : null;
}

/** Typed kg -> whole grams (capacity fields), or null. */
export function kgFromText(text: string): number | null {
  const n = parseDecimal(text);
  return n === null || !(n >= 0) ? null : Math.round(n * 1000);
}

/** Whole grams as typed kg ("2000"), for edit fields. */
export function kgToText(g: number | null | undefined): string {
  return g === null || g === undefined ? "" : String(Math.round(g) / 1000);
}

/** Minutes as `{h, m}` for the i18n sentence, or just minutes under an hour. */
export function minutesParts(min: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(min));
  return { h: Math.floor(total / 60), m: total % 60 };
}

/** `datetime-local` value of an epoch ms in the browser's zone (the person types a time near now). */
export function localInputValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The epoch ms of a `datetime-local` value, or null when it is blank or not a time. */
export function msFromLocalInput(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Status, tones and the stage stepper
// ---------------------------------------------------------------------------

/** Amber in the oven or needing a test, blue out and waiting, green released, red held (spec 5). */
export function phaseTone(phase: AgeingBatchSummary["phase"]): StatusTone {
  switch (phase) {
    case "heating":
    case "soaking":
    case "loading":
      return "amber";
    case "out":
      return "blue";
    case "released":
      return "green";
    case "held":
      return "red";
    case "closed":
    case "void":
      return "neutral";
  }
}

export function rowTone(status: AgeingRowView["status"]): StatusTone {
  switch (status) {
    case "pending":
      return "amber";
    case "released":
      return "green";
    case "held":
      return "red";
    case "closed":
    case "void":
      return "neutral";
  }
}

export function soakTone(verdict: NonNullable<AgeingBatchDetail["soak"]>["verdict"]): StatusTone {
  return verdict === "ok" ? "green" : verdict === "no_readings" ? "neutral" : "red";
}

export function capacityTone(capacity: AgeingBatchSummary["capacity"]): StatusTone {
  return capacity === "over" ? "red" : capacity === "near" ? "amber" : "neutral";
}

/** The five stages of one cycle, in order (labels `ageing.stage.*`). */
export const STAGES = ["load", "oven", "out", "test", "release"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_KEYS: Record<Stage, MessageKey> = {
  load: "ageing.stage.load",
  oven: "ageing.stage.oven",
  out: "ageing.stage.out",
  test: "ageing.stage.test",
  release: "ageing.stage.release",
};

/** Rows that still need their hardness samples before the batch can be judged. */
export function rowsToTest(batch: Pick<AgeingBatchDetail, "rows">): AgeingRowView[] {
  return batch.rows.filter((r) => r.status === "pending" && r.hardnessReadingX10 === null);
}

/** Index in STAGES of where the batch stands now. */
export function stageIndex(batch: Pick<AgeingBatchDetail, "status" | "rows">): number {
  switch (batch.status) {
    case "loading":
      return 0;
    case "in_oven":
      return 1;
    case "out":
      return rowsToTest(batch).length > 0 ? 2 : 3;
    case "released":
    case "held":
    case "closed":
      return 4;
    case "void":
      return 0;
  }
}

export type NextAction = "start" | "takeOut" | "hardness" | "release" | "none";

/** The one primary action the status allows (spec 5: Start, Take out, Record hardness or Release). */
export function nextAction(batch: Pick<AgeingBatchDetail, "status" | "rows" | "overrideApprovalId">): NextAction {
  switch (batch.status) {
    case "loading":
      return batch.rows.length > 0 ? "start" : "none";
    case "in_oven":
      return "takeOut";
    case "out":
      return rowsToTest(batch).length > 0 ? "hardness" : "release";
    case "held":
      // Release again is for after an approval (the server stamped the batch); until then a retest or a request is the way on.
      return batch.overrideApprovalId ? "release" : "none";
    default:
      return "none";
  }
}

/** Which people may take the next step (matches the server's action per procedure). */
export function nextActionPermission(action: NextAction): "ageing.load" | "ageing.record" | "ageing.release" | null {
  switch (action) {
    case "start":
    case "takeOut":
      return "ageing.load";
    case "hardness":
      return "ageing.record";
    case "release":
      return "ageing.release";
    case "none":
      return null;
  }
}

export const isLive = (b: BatchLike): boolean => b.status === "loading" || b.status === "in_oven" || b.status === "out" || b.status === "released" || b.status === "held";

/** The soak clock on the board: elapsed minutes against the recipe's soak, 0..1 for the bar. */
export function soakProgress(soakStartedAt: number | null, soakMin: number | null, now: number): { elapsedMin: number; ratio: number } | null {
  if (soakStartedAt === null || soakMin === null || soakMin <= 0) return null;
  const elapsedMin = Math.max(0, Math.floor((now - soakStartedAt) / 60_000));
  return { elapsedMin, ratio: Math.min(1, elapsedMin / soakMin) };
}

// ---------------------------------------------------------------------------
// The temperature sparkline
// ---------------------------------------------------------------------------

export type SparkReading = { at: number; tempCX10: number };
export type Spark = {
  /** `x,y x,y ...` for an SVG polyline in a width x height box. */
  points: string;
  /** The recipe band as a rectangle (y from the top, height), or null without a band. */
  band: { y: number; height: number } | null;
  /** The last reading's dot. */
  last: { x: number; y: number } | null;
  minX10: number;
  maxX10: number;
};

/**
 * Readings in time order, scaled to the box with the band included in the range, so the line can be
 * seen against the recipe. At most `maxPoints` are drawn (every n-th, always the last).
 */
export function sparkline(
  readings: readonly SparkReading[],
  box: { width: number; height: number; pad?: number },
  band: { lowX10: number; highX10: number } | null,
  maxPoints = 120,
): Spark | null {
  if (readings.length === 0) return null;
  const sorted = [...readings].sort((a, b) => a.at - b.at);
  const step = Math.max(1, Math.ceil(sorted.length / maxPoints));
  const kept = sorted.filter((_, i) => i % step === 0 || i === sorted.length - 1);
  const pad = box.pad ?? 3;
  const temps = kept.map((r) => r.tempCX10);
  const lo = Math.min(...temps, band?.lowX10 ?? Infinity);
  const hi = Math.max(...temps, band?.highX10 ?? -Infinity);
  const span = Math.max(1, hi - lo);
  const t0 = kept[0]!.at;
  const tSpan = Math.max(1, kept[kept.length - 1]!.at - t0);
  const w = box.width - pad * 2;
  const h = box.height - pad * 2;
  const x = (at: number) => (kept.length === 1 ? box.width / 2 : pad + ((at - t0) / tSpan) * w);
  const y = (v: number) => pad + h - ((v - lo) / span) * h;
  const round = (n: number) => Math.round(n * 10) / 10;
  const points = kept.map((r) => `${round(x(r.at))},${round(y(r.tempCX10))}`).join(" ");
  const lastR = kept[kept.length - 1]!;
  return {
    points,
    band: band ? { y: round(y(band.highX10)), height: round(Math.max(1, y(band.lowX10) - y(band.highX10))) } : null,
    last: { x: round(x(lastR.at)), y: round(y(lastR.tempCX10)) },
    minX10: lo,
    maxX10: hi,
  };
}

// ---------------------------------------------------------------------------
// The load picker
// ---------------------------------------------------------------------------

export type LoadLine = { pressRunLineId: string; pcsLeft: number; kgLeftG: number };

/** A line's kg for the pieces picked, as the server prorates them (a preview; the server's figure stands). */
export function lineKgG(line: Pick<LoadLine, "pcsLeft" | "kgLeftG">, pcs: number): number {
  if (pcs <= 0 || line.pcsLeft <= 0) return 0;
  if (pcs >= line.pcsLeft) return line.kgLeftG;
  return Math.round((line.kgLeftG * pcs) / line.pcsLeft);
}

export type PickState = Record<string, string>;

/** A typed pieces field as a pick: blank is nothing, over the line's pieces is the problem the sheet names. */
export function pickOf(text: string | undefined, line: Pick<LoadLine, "pcsLeft">): { pcs: number; error: "over" | "invalid" | null } {
  if (text === undefined || text.trim() === "") return { pcs: 0, error: null };
  const n = wholeFromText(text);
  if (n === null) return { pcs: 0, error: "invalid" };
  if (n > line.pcsLeft) return { pcs: n, error: "over" };
  return { pcs: n, error: null };
}

export type LoadTotals = { lines: number; pcs: number; kgG: number; problems: number };

/** What the trolley would hold: pieces and kg of the picked lines and bundles. */
export function loadTotals(
  lines: readonly LoadLine[],
  picks: PickState,
  bundles: readonly { pcs: number; weightG: number }[],
): LoadTotals {
  let pcs = 0;
  let kgG = 0;
  let count = 0;
  let problems = 0;
  for (const line of lines) {
    const p = pickOf(picks[line.pressRunLineId], line);
    if (p.error) problems += 1;
    if (p.pcs > 0 && !p.error) {
      pcs += p.pcs;
      kgG += lineKgG(line, p.pcs);
      count += 1;
    }
  }
  for (const b of bundles) {
    pcs += b.pcs;
    kgG += b.weightG;
    count += 1;
  }
  return { lines: count, pcs, kgG, problems };
}

/** Whether the load can be sent (something picked, nothing wrong, and a trolley chosen). */
export function canLoad(totals: LoadTotals, trolleyId: string | null): boolean {
  return Boolean(trolleyId) && totals.lines > 0 && totals.problems === 0;
}

/** The request body rows for the picked press lines (all-pieces picks send the pieces, never a kg). */
export function pressRowsOf(lines: readonly (LoadLine & { salesOrderLineId?: string | null })[], picks: PickState): { pressRunLineId: string; pcs: number }[] {
  const out: { pressRunLineId: string; pcs: number }[] = [];
  for (const line of lines) {
    const p = pickOf(picks[line.pressRunLineId], line);
    if (p.pcs > 0 && !p.error) out.push({ pressRunLineId: line.pressRunLineId, pcs: p.pcs });
  }
  return out;
}

/** A line fits a recipe when alloy and temper agree (unknown on either side does not block: the server decides). */
export function lineFitsRecipe(line: { alloy: string | null; temper: string | null }, recipe: { alloy: string; temper: string } | null): boolean {
  if (!recipe) return true;
  if (line.alloy && line.alloy !== recipe.alloy) return false;
  if (line.temper && line.temper !== recipe.temper) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Hardness entry
// ---------------------------------------------------------------------------

/** Samples typed in a sheet (one field per sample) to the request's x10 list; null when any filled field is bad or none is filled. */
export function hardnessReadings(texts: readonly string[]): number[] | null {
  const filled = texts.map((t) => t.trim()).filter((t) => t !== "");
  if (filled.length === 0) return null;
  const out: number[] = [];
  for (const t of filled) {
    const v = x10FromText(t);
    if (v === null) return null;
    out.push(v);
  }
  return out;
}

/** Median of the entered samples, for the preview under the fields (the server's median stands once saved). */
export function previewMedianX10(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : Math.floor((s[mid - 1]! + s[mid]! + 1) / 2);
}

// ---------------------------------------------------------------------------
// Batch actions available to a person, from the batch and the rows
// ---------------------------------------------------------------------------

export type BatchView = Pick<AgeingBatchDetail, "status" | "rows" | "successorBatchId" | "reworkOfBatchId" | "overrideApprovalId" | "pendingOverrideId" | "qcVerdict">;

export const liveRows = (b: Pick<BatchView, "rows">): AgeingRowView[] => b.rows.filter((r) => r.status !== "void");

/** Hold a line: only a line that is not yet packed from and still pending or released. */
export function canHoldRow(batch: Pick<BatchView, "status">, row: AgeingRowView): boolean {
  return (batch.status === "out" || batch.status === "released" || batch.status === "held") && (row.status === "pending" || row.status === "released") && row.packedPcs === 0 && row.source !== "bundle";
}

export function canUnholdRow(row: AgeingRowView): boolean {
  return row.status === "held";
}

/** Held pieces can be aged again once the batch has been judged. */
export function canRework(batch: Pick<BatchView, "status" | "rows" | "successorBatchId">): boolean {
  if (batch.successorBatchId) return false;
  return (batch.status === "held" || batch.status === "released") && batch.rows.some((r) => r.status === "held" && r.source !== "bundle");
}

/** Remaining pieces on a line can be thrown away (discard) once the line is judged. */
export function canDiscardRow(batch: Pick<BatchView, "status">, row: AgeingRowView): boolean {
  return (batch.status === "released" || batch.status === "held") && (row.status === "held" || row.status === "released") && row.remainingPcs > 0 && row.source !== "bundle";
}

/** Asking for approval makes sense for a judged batch that has not got one and has none waiting. */
export function canRequestOverride(batch: Pick<BatchView, "status" | "overrideApprovalId" | "pendingOverrideId">, hasHeldLine: boolean): boolean {
  return (batch.status === "held" || batch.status === "out") && hasHeldLine && !batch.overrideApprovalId && !batch.pendingOverrideId;
}

/**
 * Void is open while loading (ageing.load; a rework successor still loading is the supervisor's: voiding it undoes
 * the rework, r1) or after take-out and before any piece moved (ageing.release).
 */
export function voidPermission(batch: Pick<BatchView, "status"> & Partial<Pick<BatchView, "reworkOfBatchId">>): "ageing.load" | "ageing.release" | null {
  if (batch.status === "loading") return batch.reworkOfBatchId ? "ageing.release" : "ageing.load";
  if (batch.status === "out" || batch.status === "held" || batch.status === "released") return "ageing.release";
  return null;
}

// ---------------------------------------------------------------------------
// Board grouping
// ---------------------------------------------------------------------------

export type BoardCard = Pick<AgeingBatchSummary, "id" | "status" | "ovenId" | "trolleyId">;

/** The oven's current batch (in the oven), by oven id. */
export function batchByOven<T extends BoardCard>(batches: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const b of batches) if (b.status === "in_oven" && b.ovenId) map.set(b.ovenId, b);
  return map;
}

/** Trolleys with a batch not in the oven (loading, out, released, held), by trolley id. */
export function batchByTrolley<T extends BoardCard>(batches: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const b of batches) if (b.status !== "closed" && b.status !== "void") map.set(b.trolleyId, b);
  return map;
}

// ---------------------------------------------------------------------------
// Search params (route files import only pure modules)
// ---------------------------------------------------------------------------

export const STATUS_FILTERS = ["loading", "in_oven", "out", "released", "held", "closed", "void"] as const;
