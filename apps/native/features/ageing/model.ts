/**
 * Pure view models for the ageing station on the phone (FP-AG-16, W3-AG-N): the stage stepper, the one action a
 * batch allows, the typed numbers (temperature and hardness are x10 integers on the wire, the gas meter is in
 * thousandths), the load picker's arithmetic, who may open the station and the Today tile. No React here, so bun
 * tests run it. The functions marked "same as the web" are the web's `features/ageing/model.ts` word for word
 * (`ageing-model.test.ts` compares them); every verdict (soak, hardness, release plan, remaining pieces, totals) is
 * the server's and nothing here decides one.
 */
import type { StatusTone } from "@orrn/domain";
import { parseDecimal } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import { canAny, type Action, type Me } from "@orrn/server/lib/permissions";
import type { AgeingBatchDetail, AgeingBatchSummary, AgeingRowView } from "@orrn/server/lib/ageingContracts";

// ---------------------------------------------------------------------------
// Typed and shown numbers (same as the web)
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

/** Minutes as `{h, m}` for the i18n sentence, or just minutes under an hour. */
export function minutesParts(min: number): { h: number; m: number } {
  const total = Math.max(0, Math.round(min));
  return { h: Math.floor(total / 60), m: total % 60 };
}

// ---------------------------------------------------------------------------
// Status, tones and the stage stepper (same as the web)
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

/** A hardness line's chip: pass green, fail red, and null (a sample of the other method, not deciding) neutral, never fail. */
export function hardnessTone(pass: boolean | null): StatusTone {
  return pass === null ? "neutral" : pass ? "green" : "red";
}

/** The "saved" note after a hardness save: neutral for a sample of the other method (`pass` null), never green. */
export function hardnessNoteTone(pass: boolean | null): "green" | "red" | "neutral" {
  return pass === null ? "neutral" : pass ? "green" : "red";
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

/** The soak clock on the board: elapsed minutes against the recipe's soak, 0..1 for the bar. */
export function soakProgress(soakStartedAt: number | null, soakMin: number | null, now: number): { elapsedMin: number; ratio: number } | null {
  if (soakStartedAt === null || soakMin === null || soakMin <= 0) return null;
  const elapsedMin = Math.max(0, Math.floor((now - soakStartedAt) / 60_000));
  return { elapsedMin, ratio: Math.min(1, elapsedMin / soakMin) };
}

// ---------------------------------------------------------------------------
// Board grouping (same as the web)
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
// The temperature sparkline (same as the web)
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
// The load picker (same as the web)
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

/**
 * The load request's body (without its key). It has NO `batchId`: a trolley that already carries a loading batch
 * gets the pieces added to it by the server. A batch id here would change the body after an unsure answer (the
 * re-read gives the trolley its open batch), make a new key, and load the same pieces twice.
 */
export function loadBody(
  trolleyId: string,
  lines: readonly (LoadLine & { salesOrderLineId?: string | null })[],
  picks: PickState,
  bundles: readonly { bundleId: string }[],
): { trolleyId: string; rows: { pressRunLineId: string; pcs: number }[]; bundles: { bundleId: string }[]; manual: never[] } {
  return { trolleyId, rows: pressRowsOf(lines, picks), bundles: bundles.map((b) => ({ bundleId: b.bundleId })), manual: [] };
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

// ---------------------------------------------------------------------------
// Hardness entry (same as the web)
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
// Batch actions available to a person, from the batch and the rows (same as the web)
// ---------------------------------------------------------------------------

export type BatchView = Pick<AgeingBatchDetail, "status" | "rows" | "successorBatchId" | "reworkOfBatchId" | "overrideApprovalId" | "pendingOverrideId" | "qcVerdict">;

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
// The phone's own rules
// ---------------------------------------------------------------------------

/** Anyone holding one of these opens the station (More, then the board). The server still checks each write. */
export const AGEING_OPENERS = ["ageing.view", "ageing.load", "ageing.record", "ageing.release"] as const satisfies readonly Action[];

/** The company has the ageing module on (an empty module list means every module is on, as on the web's nav). */
export function ageingModuleOn(me: Pick<Me, "company"> | null | undefined): boolean {
  const modules = (me?.company?.modules ?? []).map((m) => m.toLowerCase());
  return modules.length === 0 || modules.includes("ageing");
}

/** Who sees Ageing under More: the module is on and the role holds a view or a floor action. */
export function showsAgeing(me: Me | null | undefined): boolean {
  return Boolean(me?.company) && ageingModuleOn(me) && canAny(me, AGEING_OPENERS);
}

/**
 * Today's Ageing tile from `dashboard.today().ageing`. Null (no tile) when the server sent none (no `ageing.view`)
 * or when the plant's module list leaves ageing out: the server gates only on the permission and sends 0/0/0 to a
 * plant without the module. Held turns it red; pieces waiting for a test are blue; otherwise amber.
 */
export function ageingTile(
  ageing: { inOven: number; held: number; out: number } | null | undefined,
  me: Pick<Me, "company"> | null | undefined,
): { inOven: number; held: number; out: number; tone: StatusTone } | null {
  if (!ageing || !ageingModuleOn(me)) return null;
  const tone: StatusTone = ageing.held > 0 ? "red" : ageing.out > 0 ? "blue" : ageing.inOven > 0 ? "amber" : "neutral";
  return { inOven: ageing.inOven, held: ageing.held, out: ageing.out, tone };
}

/** What this phone does not do: rework, discard and void stay on the web. Which of them apply to this batch, in order. */
export function webOnlyActions(batch: BatchView): ("rework" | "discard" | "void")[] {
  const out: ("rework" | "discard" | "void")[] = [];
  if (canRework(batch)) out.push("rework");
  if (batch.rows.some((r) => canDiscardRow(batch, r))) out.push("discard");
  if (voidPermission(batch) !== null) out.push("void");
  return out;
}

/** The write-off words are shown when a closed batch's bundle void wrote pieces off: a closed batch gives nothing back. */
export function isClosedBatch(batch: Pick<BatchView, "status">): boolean {
  return batch.status === "closed";
}

/** The path of this batch on the web, for "Open on the web". */
export function batchWebPath(id: string): string {
  return `/ageing/batch/${id}`;
}

export type StartPick = { ovenId: string; recipeId: string; shiftId: string };

/**
 * What the start sheet pre-fills. The oven stays when it is still free, else the first free one; the shift is the
 * plant's current production-day shift, else the first; the recipe is the plant's default alloy and temper (a top-up
 * for a reworked batch), else the first of the kind, else the first active. Pure so the pick is tested.
 */
export function startDefaults(input: {
  ovens: readonly { id: string; status: string; busyBatchId: string | null }[];
  recipes: readonly { id: string; status: string; kind: string; alloy: string; temper: string }[];
  shifts: readonly { id: string }[];
  settings: { defaultAlloy?: string | null; defaultTemper?: string | null; currentShiftId?: string | null } | undefined;
  current: Partial<StartPick>;
  topUp: boolean;
}): StartPick {
  const free = input.ovens.filter((o) => o.status === "active" && !o.busyBatchId);
  const active = input.recipes.filter((r) => r.status === "active");
  const ovenId = input.current.ovenId && free.some((o) => o.id === input.current.ovenId) ? input.current.ovenId : (free[0]?.id ?? "");
  const shiftId =
    input.current.shiftId && input.shifts.some((s) => s.id === input.current.shiftId)
      ? input.current.shiftId
      : (input.shifts.find((s) => s.id === input.settings?.currentShiftId)?.id ?? input.shifts[0]?.id ?? "");
  let recipeId = input.current.recipeId && active.some((r) => r.id === input.current.recipeId) ? input.current.recipeId : "";
  // The plant's default alloy and temper pick the recipe, so wait until the settings are in.
  if (!recipeId && input.settings) {
    const kind = input.topUp ? "top_up" : "full";
    const pick = active.find((r) => r.kind === kind && r.alloy === input.settings?.defaultAlloy && r.temper === input.settings?.defaultTemper) ?? active.find((r) => r.kind === kind) ?? active[0];
    recipeId = pick?.id ?? "";
  }
  return { ovenId, recipeId, shiftId };
}

/** A typed reading is open while the batch is in the oven and for 30 minutes after it came out (the server refuses later ones). */
export function canAddReading(batch: Pick<AgeingBatchDetail, "status" | "outAt">, now: number): boolean {
  return batch.status === "in_oven" || (batch.status === "out" && batch.outAt !== null && now - batch.outAt < 30 * 60_000);
}

/**
 * After an unsure hold: did it land? A line hold landed when that line reads held. A whole-trolley hold landed
 * when some live line is held and none is left pending or released (the server holds them all together). The
 * sheet then closes, so a second tap never shows a red "already held".
 */
export function holdLanded(batch: Pick<BatchView, "rows">, rowId: string | null): boolean {
  if (rowId !== null) return batch.rows.find((r) => r.id === rowId)?.status === "held";
  const live = batch.rows.filter((r) => r.status === "pending" || r.status === "released" || r.status === "held");
  return live.some((r) => r.status === "held") && live.every((r) => r.status === "held");
}

/** After an unsure clear: did it land? The line no longer reads held (or is gone). */
export function unholdLanded(batch: Pick<BatchView, "rows">, rowId: string): boolean {
  return batch.rows.find((r) => r.id === rowId)?.status !== "held";
}
