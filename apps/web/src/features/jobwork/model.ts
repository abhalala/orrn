/**
 * Process steps, the screen rules (XE parity lane JOBWORK). Pure: the figures that matter (loss, yield, cost, age
 * buckets, the refusal of a return) come from `@orrn/domain` `jobwork.ts`, the same functions the server runs, so the
 * receive sheet can say before the tap what the server will say after it. Nothing here reads the network.
 *
 * Weights are integer grams, lengths integer mm, money integer paise. A box that takes a weight is a `PlantInput` whose
 * draft is text in kg (`MASS_KG`) or mm (`LENGTH_MM`); `draftToCanonical` turns that draft into the stored integer.
 */
import {
  bundleFinishState,
  challanValuePaise,
  parseDecimal,
  processCost,
  returnFigures,
  returnRefusal,
  vendorAgeBuckets,
  type FinishState,
  type ProcessCost,
  type ProcessKind,
  type ProcessReturnRefusal,
  type ReturnFigures,
  type StatusTone,
  type VendorAgeBucket,
} from "@orrn/domain";

import { draftToCanonical, LENGTH_MM, MASS_KG } from "@/shared/lib/plant-input";

/** The server takes at most this many bundles on one step (`MAX_STEP_BUNDLES`). */
export const MAX_BUNDLES = 200;
/** A coat or an operation can add this many lines to a receive sheet. */
export const MAX_OUTPUT_LINES = 200;

// ---------------------------------------------------------------------------
// Text to stored integers
// ---------------------------------------------------------------------------

/** A weight typed in a `PlantInput` (draft in kg) as whole grams; null when blank, zero or not a number. */
export function gramsOf(draft: string): number | null {
  const g = draftToCanonical(MASS_KG, draft);
  return g !== null && g > 0 ? g : null;
}

/** Like `gramsOf` but a blank box is zero (an optional weight: rejects, scrap); null when it is text that is not a weight. */
export function gramsOrZero(draft: string): number | null {
  if (draft.trim() === "") return 0;
  const g = draftToCanonical(MASS_KG, draft);
  return g === null ? null : g;
}

/** A length typed in a `PlantInput` (draft in mm) as whole mm; null when blank, zero or not a number. */
export function mmOf(draft: string): number | null {
  const mm = draftToCanonical(LENGTH_MM, draft);
  return mm !== null && mm > 0 ? mm : null;
}

/** Whole pieces from typed text; null for blank, zero, a fraction or anything that is not a count. */
export function pcsOf(text: string): number | null {
  const t = text.trim().replace(/,/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** Whole pieces, a blank box is zero; null for text that is not a count. */
export function pcsOrZero(text: string): number | null {
  return text.trim() === "" ? 0 : pcsOf(text) ?? (/^0+$/.test(text.trim()) ? 0 : null);
}

/** Rupees typed ("198.50") as paise; null when blank, zero or not a number. */
export function paiseOf(text: string): number | null {
  const rupees = parseDecimal(text);
  if (rupees === null || rupees <= 0) return null;
  return Math.round(rupees * 100);
}

/** Paise as the text a rupee box shows ("198.5"). */
export function paiseDraft(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return "";
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : String(Math.round(paise) / 100);
}

/** The server caps a rate or declared value at 100,000,000 paise. */
export const MAX_PAISE = 100_000_000;

/** `basis points` as "2.5": one decimal, no sign. */
export function percentOfBp(bp: number): string {
  return String(Math.round(Math.abs(bp) / 10) / 10);
}

// ---------------------------------------------------------------------------
// At the vendors: age, grouped by vendor
// ---------------------------------------------------------------------------

export type PendingItem = {
  id: string;
  number: string;
  process: string;
  finishCode: string | null;
  vendorId: string | null;
  vendorName: string | null;
  vendorCode: string | null;
  expectedReturn: string | null;
  outBundles: number;
  outPcs: number;
  outG: number;
  days: number;
  bucket: VendorAgeBucket;
  overdue: boolean;
  daysToLimit: number;
};

export type VendorGroup = {
  key: string;
  vendorName: string;
  vendorCode: string;
  steps: PendingItem[];
  outBundles: number;
  outPcs: number;
  outG: number;
  oldestDays: number;
  overdue: number;
};

/** Pending challans per vendor: the vendor with the oldest challan first, the oldest challan first inside it. */
export function groupPendingByVendor(items: readonly PendingItem[]): VendorGroup[] {
  const groups = new Map<string, VendorGroup>();
  for (const s of items) {
    const key = s.vendorId ?? "none";
    const g =
      groups.get(key) ??
      ({ key, vendorName: s.vendorName ?? "", vendorCode: s.vendorCode ?? "", steps: [], outBundles: 0, outPcs: 0, outG: 0, oldestDays: 0, overdue: 0 } satisfies VendorGroup);
    g.steps.push(s);
    g.outBundles += s.outBundles;
    g.outPcs += s.outPcs;
    g.outG += s.outG;
    g.oldestDays = Math.max(g.oldestDays, s.days);
    if (s.overdue) g.overdue += 1;
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) g.steps.sort((a, b) => b.days - a.days || a.number.localeCompare(b.number, "en", { numeric: true }));
  return out.sort((a, b) => b.oldestDays - a.oldestDays || a.vendorName.localeCompare(b.vendorName));
}

/** Overdue is red whatever the age; else the age bucket decides: a week is calm, over a month is red. */
export function ageTone(bucket: VendorAgeBucket, overdue: boolean): StatusTone {
  if (overdue) return "red";
  return bucket === "d0_7" ? "green" : bucket === "d8_15" ? "blue" : bucket === "d16_30" ? "amber" : "red";
}

export type BucketCell = { bucket: VendorAgeBucket; steps: number; outG: number; tone: StatusTone };

/** The four age buckets in order, empty ones kept (the strip always shows the same four). */
export function bucketCells(buckets: Record<VendorAgeBucket, { steps: number; outG: number }>): BucketCell[] {
  return vendorAgeBuckets.map((bucket) => ({ bucket, steps: buckets[bucket].steps, outG: buckets[bucket].outG, tone: ageTone(bucket, false) }));
}

/** GST: job work goods come back within a year. `soon` inside 60 days, `over` once the limit has passed. */
export function limitState(daysToLimit: number): "ok" | "soon" | "over" {
  return daysToLimit < 0 ? "over" : daysToLimit <= 60 ? "soon" : "ok";
}

// ---------------------------------------------------------------------------
// Register filters and what a step may still do
// ---------------------------------------------------------------------------

export const REGISTER_KINDS = ["jobwork", "finish", "draw", "fabricate"] as const satisfies readonly ProcessKind[];
export const REGISTER_STATUSES = ["open", "partial", "done", "cancelled"] as const;
export type RegisterStatus = (typeof REGISTER_STATUSES)[number];

export function statusTone(status: RegisterStatus): StatusTone {
  return status === "open" ? "amber" : status === "partial" ? "blue" : status === "done" ? "green" : "neutral";
}

/** A step takes a return while it is open or part back; it can be cancelled only before anything came back. */
export function stepActions(status: RegisterStatus): { receive: boolean; cancel: boolean } {
  return { receive: status === "open" || status === "partial", cancel: status === "open" };
}

/** Job work is received by `jobwork.receive`; every in-house kind by `process.run`. */
export function receiveAction(kind: ProcessKind): "jobwork.receive" | "process.run" {
  return kind === "jobwork" ? "jobwork.receive" : "process.run";
}
export function cancelAction(kind: ProcessKind): "jobwork.send" | "process.run" {
  return kind === "jobwork" ? "jobwork.send" : "process.run";
}

/** Which router's `receive` and `cancel` a step of this kind goes through. */
export function routerOf(kind: ProcessKind): "steps" | "drawbench" | "fabrication" {
  return kind === "draw" ? "drawbench" : kind === "fabricate" ? "fabrication" : "steps";
}

/** The detail page of a step is always /jobwork/$id. */
export const stepPath = (id: string) => `/jobwork/${id}`;

export type ProcessWord = "anodise" | "powder_coat" | "pvd" | "machining" | "other" | "draw" | "fabricate";

/** A stored process as a key of `jw.process.*`; anything the dictionary does not know reads as Other. */
export function processWord(process: string): ProcessWord {
  return (["anodise", "powder_coat", "pvd", "machining", "other", "draw", "fabricate"] as const).find((p) => p === process) ?? "other";
}

/** A return puts a coat on (and may add weight) for anodise, powder coat and PVD only. */
export function isCoat(process: string): boolean {
  return process === "anodise" || process === "powder_coat" || process === "pvd";
}

/** The server's refusal code of a return, as the `jw.refusal.*` key that says it. */
export function refusalKeyOf(code: ProcessReturnRefusal): "jw.refusal.noOutput" | "jw.refusal.negativeWeight" | "jw.refusal.gainTooHigh" | "jw.refusal.outputOverInput" {
  const keys = {
    no_output: "jw.refusal.noOutput",
    negative_weight: "jw.refusal.negativeWeight",
    gain_too_high: "jw.refusal.gainTooHigh",
    output_over_input: "jw.refusal.outputOverInput",
  } as const;
  return keys[code];
}

/** The default way a kind comes back: job work and the line return the same bundles; the bench and fabrication make new ones. */
export function defaultMode(kind: ProcessKind): "same" | "new" {
  return kind === "draw" || kind === "fabricate" ? "new" : "same";
}

/** Whether a return needs a yard: job work always (it left the plant); an in-house return only when it makes new bundles. */
export function needsYard(kind: ProcessKind, mode: "same" | "new"): boolean {
  return kind === "jobwork" || mode === "new";
}

// ---------------------------------------------------------------------------
// Receive sheet
// ---------------------------------------------------------------------------

export type InputRow = { bundleId: string; serial: string; weightG: number; pcs: number; lengthMm: number; returnId: string | null; dieId: string; sectionCode: string };

/** The inputs still out (no return yet). */
export function openInputs<T extends { returnId: string | null }>(inputs: readonly T[]): T[] {
  return inputs.filter((i) => !i.returnId);
}

export type SameDraft = { weight: string; rejectPcs: string; rejectKg: string };
export const EMPTY_SAME: SameDraft = { weight: "", rejectPcs: "", rejectKg: "" };

export type RowProblem = "weight" | "rejectPcs" | "rejectKg" | "rejectsAll" | "length" | "pcs";

export type SameLine = { bundleId: string; weightG: number; rejectPcs: number; rejectG: number };

export type ReturnPreview = {
  /** Bundles this return closes. */
  closing: number;
  figures: ReturnFigures | null;
  refusal: ProcessReturnRefusal | null;
  /** First problem per row key (a bundle id, or `out-<n>` for an output line). */
  rowProblems: Record<string, RowProblem>;
  /** Text in the scrap or reject box that is not a weight. */
  scrapBad: boolean;
  rejectBad: boolean;
  /** Nothing is wrong and something is entered: the Save button may be enabled. */
  ready: boolean;
};

const emptyPreview = (): ReturnPreview => ({ closing: 0, figures: null, refusal: null, rowProblems: {}, scrapBad: false, rejectBad: false, ready: false });

/**
 * Mode `same`: a row is "back" when its weight is typed; rows left blank stay out (a part return). Each back row needs a
 * weight, whole reject pieces below its piece count, and a reject weight that is a weight.
 */
export function previewSame(a: { inputs: readonly InputRow[]; drafts: Readonly<Record<string, SameDraft>>; scrapDraft: string; coat: boolean }): { preview: ReturnPreview; lines: SameLine[] } {
  const p = emptyPreview();
  const lines: SameLine[] = [];
  let inputG = 0;
  let outputG = 0;
  let rejectG = 0;
  for (const i of a.inputs) {
    const d = a.drafts[i.bundleId] ?? EMPTY_SAME;
    if (d.weight.trim() === "" && d.rejectPcs.trim() === "" && d.rejectKg.trim() === "") continue;
    const w = gramsOf(d.weight);
    const rp = pcsOrZero(d.rejectPcs);
    const rg = gramsOrZero(d.rejectKg);
    if (w === null) p.rowProblems[i.bundleId] = "weight";
    else if (rp === null) p.rowProblems[i.bundleId] = "rejectPcs";
    else if (rg === null) p.rowProblems[i.bundleId] = "rejectKg";
    else if (rp >= i.pcs) p.rowProblems[i.bundleId] = "rejectsAll";
    if (p.rowProblems[i.bundleId]) continue;
    lines.push({ bundleId: i.bundleId, weightG: w!, rejectPcs: rp!, rejectG: rg! });
    inputG += i.weightG;
    outputG += w!;
    rejectG += rg!;
  }
  const scrap = gramsOrZero(a.scrapDraft);
  p.scrapBad = scrap === null;
  p.closing = lines.length;
  if (lines.length > 0 && scrap !== null) {
    const fig = { inputG, outputG, rejectG, scrapG: scrap };
    p.figures = returnFigures(fig);
    p.refusal = returnRefusal(fig, { coat: a.coat });
  }
  p.ready = lines.length > 0 && Object.keys(p.rowProblems).length === 0 && !p.scrapBad && p.refusal === null;
  return { preview: p, lines };
}

export type OutputDraft = { dieId: string; length: string; pcs: string; weight: string };
export const EMPTY_OUTPUT: OutputDraft = { dieId: "", length: "", pcs: "", weight: "" };

export type OutputLine = { dieId?: string; lengthMm: number; pcs: number; weightG: number };

/**
 * Mode `new`: the picked inputs (all still out when `picked` is null) are used up and the output lines become new bundles.
 * A line with nothing typed is ignored; one half typed is a problem on that line.
 */
export function previewNew(a: {
  inputs: readonly InputRow[];
  /** The inputs this return uses up; null means every input still out. */
  picked: readonly string[] | null;
  outputs: readonly OutputDraft[];
  rejectDraft: string;
  scrapDraft: string;
  coat: boolean;
}): { preview: ReturnPreview; lines: OutputLine[]; closingIds: string[] } {
  const p = emptyPreview();
  const open = a.inputs.filter((i) => !i.returnId);
  const picked = a.picked;
  const closing = picked === null ? open : open.filter((i) => picked.includes(i.bundleId));
  const lines: OutputLine[] = [];
  let outputG = 0;
  a.outputs.forEach((o, n) => {
    if (o.length.trim() === "" && o.pcs.trim() === "" && o.weight.trim() === "") return;
    const key = `out-${n}`;
    const mm = mmOf(o.length);
    const pcs = pcsOf(o.pcs);
    const g = gramsOf(o.weight);
    if (mm === null || mm > 20_000) p.rowProblems[key] = "length";
    else if (pcs === null) p.rowProblems[key] = "pcs";
    else if (g === null) p.rowProblems[key] = "weight";
    if (p.rowProblems[key]) return;
    lines.push({ ...(o.dieId ? { dieId: o.dieId } : {}), lengthMm: mm!, pcs: pcs!, weightG: g! });
    outputG += g!;
  });
  const reject = gramsOrZero(a.rejectDraft);
  const scrap = gramsOrZero(a.scrapDraft);
  p.rejectBad = reject === null;
  p.scrapBad = scrap === null;
  p.closing = closing.length;
  if (closing.length > 0 && reject !== null && scrap !== null && (lines.length > 0 || Object.keys(p.rowProblems).length === 0)) {
    const fig = { inputG: closing.reduce((n, i) => n + i.weightG, 0), outputG, rejectG: reject, scrapG: scrap };
    p.figures = returnFigures(fig);
    p.refusal = returnRefusal(fig, { coat: a.coat });
  }
  p.ready = closing.length > 0 && lines.length > 0 && Object.keys(p.rowProblems).length === 0 && !p.rejectBad && !p.scrapBad && p.refusal === null;
  return { preview: p, lines, closingIds: closing.map((i) => i.bundleId) };
}

/** What the vendor or the line bills for this return, and per good kg: the domain's `processCost`. */
export function costPreview(ratePaise: number | null, figures: ReturnFigures | null): ProcessCost | null {
  if (!figures || ratePaise === null) return null;
  return processCost({ ratePaisePerKg: ratePaise, billedG: figures.inputG, outputG: figures.outputG });
}

export type ReceiveFields = {
  id: string;
  mode: "same" | "new";
  locationId: string;
  vendorDocNo: string;
  /** Rupees typed; only a holder of `jobwork.cost` sees the box, an empty one keeps the step's own rate. */
  rateDraft: string;
  minutes: string;
  passes: string;
  note: string;
};

/** The body of `steps.receive`, `drawbench.receive` or `fabrication.receive`. Blank optional boxes are left out. */
export function receivePayload(
  f: ReceiveFields,
  built: { same: readonly SameLine[]; output: readonly OutputLine[]; closingIds: readonly string[]; scrapG: number; rejectG: number; rejectPcs: number },
  needsLocation: boolean,
) {
  const rate = paiseOf(f.rateDraft);
  const minutes = pcsOf(f.minutes);
  const passes = pcsOf(f.passes);
  return {
    id: f.id,
    mode: f.mode,
    ...(needsLocation && f.locationId ? { locationId: f.locationId } : {}),
    ...(f.vendorDocNo.trim() ? { vendorDocNo: f.vendorDocNo.trim() } : {}),
    ...(rate !== null ? { ratePaisePerKg: rate } : {}),
    ...(minutes !== null ? { minutes } : {}),
    ...(passes !== null ? { passes } : {}),
    ...(f.note.trim() ? { note: f.note.trim() } : {}),
    scrapG: built.scrapG,
    ...(f.mode === "same"
      ? { same: built.same.map((l) => ({ bundleId: l.bundleId, weightG: l.weightG, rejectPcs: l.rejectPcs, rejectG: l.rejectG })) }
      : { inputBundleIds: [...built.closingIds], outputs: built.output.map((o) => ({ ...o })), rejectG: built.rejectG, rejectPcs: built.rejectPcs }),
  };
}

// ---------------------------------------------------------------------------
// New challan, in-house start, scanning
// ---------------------------------------------------------------------------

/** A bundle on its way onto a step: picked from stock (has an id) or typed or scanned (the server resolves the code). */
export type BundlePick = { key: string; bundleId?: string; code: string; label: string; weightG?: number };

const keyOf = (code: string) => code.trim().toUpperCase();

/** Add a pick unless it is already there; says whether it was a repeat. */
export function addPick(picks: readonly BundlePick[], pick: Omit<BundlePick, "key">): { picks: BundlePick[]; repeat: boolean } {
  const key = pick.bundleId ?? keyOf(pick.code);
  // A serial typed first and then picked from stock (or the other way round) is the same bundle: its code is its serial.
  const same = picks.some((p) => p.key === key || (p.bundleId && p.bundleId === pick.bundleId) || keyOf(p.code) === keyOf(pick.code));
  if (same) return { picks: [...picks], repeat: true };
  return { picks: [...picks, { ...pick, key }], repeat: false };
}

/** Serials typed or pasted, one per line or split by commas, spaces or semicolons; repeats are dropped and counted. */
export function parseCodes(text: string): { codes: string[]; repeats: number } {
  const seen = new Set<string>();
  const codes: string[] = [];
  let repeats = 0;
  for (const raw of text.split(/[\s,;]+/)) {
    const c = raw.trim();
    if (!c) continue;
    const k = keyOf(c);
    if (seen.has(k)) repeats += 1;
    else {
      seen.add(k);
      codes.push(c);
    }
  }
  return { codes, repeats };
}

export function splitPicks(picks: readonly BundlePick[]): { bundleIds: string[]; codes: string[] } {
  return { bundleIds: picks.filter((p) => p.bundleId).map((p) => p.bundleId!), codes: picks.filter((p) => !p.bundleId).map((p) => p.code) };
}

/** Known weight of the picks that came from stock (typed codes weigh nothing here: the server reads them). */
export function knownWeightG(picks: readonly BundlePick[]): number {
  return picks.reduce((n, p) => n + (p.weightG ?? 0), 0);
}

export type SendDraft = {
  vendorId: string;
  process: string;
  finishCode: string;
  expectedReturn: string;
  vehicleNo: string;
  valueDraft: string;
  note: string;
  picks: readonly BundlePick[];
};

export type SendProblem = "vendor" | "process" | "bundles" | "tooMany" | "date" | "value";

/** Everything that stops a challan from being made, in the order the form shows it. */
export function sendProblems(d: SendDraft, today: string): SendProblem[] {
  const out: SendProblem[] = [];
  if (!d.vendorId) out.push("vendor");
  if (!d.process) out.push("process");
  if (d.picks.length === 0) out.push("bundles");
  else if (d.picks.length > MAX_BUNDLES) out.push("tooMany");
  if (d.expectedReturn && (!/^\d{4}-\d{2}-\d{2}$/.test(d.expectedReturn) || d.expectedReturn < today)) out.push("date");
  if (d.valueDraft.trim() !== "") {
    const v = paiseOf(d.valueDraft);
    if (v === null || v > MAX_PAISE) out.push("value");
  }
  return out;
}

export function sendPayload(d: SendDraft, seesCost: boolean) {
  const { bundleIds, codes } = splitPicks(d.picks);
  const value = seesCost ? paiseOf(d.valueDraft) : null;
  return {
    vendorId: d.vendorId,
    process: d.process as "anodise" | "powder_coat" | "pvd" | "machining" | "other",
    ...(bundleIds.length ? { bundleIds } : {}),
    ...(codes.length ? { codes } : {}),
    ...(d.finishCode.trim() ? { finishCode: d.finishCode.trim() } : {}),
    ...(d.expectedReturn ? { expectedReturn: d.expectedReturn } : {}),
    ...(d.vehicleNo.trim() ? { vehicleNo: d.vehicleNo.trim() } : {}),
    ...(value !== null ? { valuePaisePerKg: value } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

export type ChemicalRow = { name: string; qty: string };

/** Chemical rows with a name, trimmed; rows left blank are dropped. A quantity with no name is a problem. */
export function chemicalsOf(rows: readonly ChemicalRow[]): { chemicals: { name: string; qty: string }[]; bad: boolean } {
  const chemicals: { name: string; qty: string }[] = [];
  let bad = false;
  for (const r of rows) {
    const name = r.name.trim();
    const qty = r.qty.trim();
    if (!name && !qty) continue;
    if (!name) bad = true;
    else chemicals.push({ name, qty });
  }
  return { chemicals, bad };
}

export type StartDraft = {
  process: string;
  finishCode: string;
  batchNo: string;
  chemicals: readonly ChemicalRow[];
  passes: string;
  outSize: string;
  ops: readonly string[];
  note: string;
  picks: readonly BundlePick[];
};

export type StartProblem = "process" | "bundles" | "tooMany" | "chemicals" | "passes";

export function startProblems(kind: Exclude<ProcessKind, "jobwork">, d: StartDraft): StartProblem[] {
  const out: StartProblem[] = [];
  if (kind === "finish" && !d.process) out.push("process");
  if (d.picks.length === 0) out.push("bundles");
  else if (d.picks.length > MAX_BUNDLES) out.push("tooMany");
  if (kind === "finish" && chemicalsOf(d.chemicals).bad) out.push("chemicals");
  if (kind === "draw" && d.passes.trim() !== "" && (pcsOf(d.passes) === null || pcsOf(d.passes)! > 100)) out.push("passes");
  return out;
}

/** The body of `steps.start`, `drawbench.start` or `fabrication.start`. */
export function startPayload(kind: Exclude<ProcessKind, "jobwork">, d: StartDraft) {
  const { bundleIds, codes } = splitPicks(d.picks);
  const { chemicals } = chemicalsOf(d.chemicals);
  const passes = pcsOf(d.passes);
  return {
    ...(bundleIds.length ? { bundleIds } : {}),
    ...(codes.length ? { codes } : {}),
    ...(kind === "finish" ? { process: d.process as "anodise" | "powder_coat" | "pvd" | "machining" | "other" } : {}),
    ...(kind === "finish" && d.finishCode.trim() ? { finishCode: d.finishCode.trim() } : {}),
    ...(kind === "finish" && d.batchNo.trim() ? { batchNo: d.batchNo.trim() } : {}),
    ...(kind === "finish" && chemicals.length ? { chemicals } : {}),
    ...(kind === "draw" && passes !== null ? { passes } : {}),
    ...(kind === "draw" && d.outSize.trim() ? { outSize: d.outSize.trim() } : {}),
    ...(kind === "fabricate" ? { ops: d.ops as ("cut" | "punch" | "cnc" | "drill" | "other")[] } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

/** Toggle an operation in the multi-select, keeping the list in the order the plant lists them. */
export function toggleOp(order: readonly string[], current: readonly string[], op: string): string[] {
  const set = new Set(current);
  if (set.has(op)) set.delete(op);
  else set.add(op);
  return order.filter((o) => set.has(o));
}

// ---------------------------------------------------------------------------
// The challan paper
// ---------------------------------------------------------------------------

export type ChallanItem = { bundles: number; pcs: number; weightG: number; valuePaise: number };

/** Column totals of the challan lines (the server sums the same lines; this is what the foot of the paper prints). */
export function challanTotals(items: readonly ChallanItem[]): ChallanItem {
  return items.reduce((t, i) => ({ bundles: t.bundles + i.bundles, pcs: t.pcs + i.pcs, weightG: t.weightG + i.weightG, valuePaise: t.valuePaise + i.valuePaise }), { bundles: 0, pcs: 0, weightG: 0, valuePaise: 0 });
}

/** Declared value of a line: the domain's rule, so the paper and a re-check agree. */
export function lineValuePaise(valuePaisePerKg: number | null, weightG: number): number {
  return challanValuePaise(valuePaisePerKg, weightG);
}

/** The serials on the challan as one line of text, in the order scanned. */
export function serialsLine(serials: readonly string[]): string {
  return serials.join(", ");
}

// ---------------------------------------------------------------------------
// Order line and bundle page
// ---------------------------------------------------------------------------

export type FinishTally = Record<"done" | "at_vendor" | "in_process" | "pending", { bundles: number; weightG: number }>;
export type FinishPart = { state: "done" | "at_vendor" | "in_process" | "pending"; bundles: number; weightG: number; tone: StatusTone };

const FINISH_TONE: Record<FinishPart["state"], StatusTone> = { done: "green", at_vendor: "blue", in_process: "amber", pending: "neutral" };
const FINISH_ORDER = ["done", "at_vendor", "in_process", "pending"] as const;

/** The parts of an order line's finish that have bundles, in the order done, at the vendor, on the line, not yet. Empty hides the strip. */
export function finishParts(line: Partial<FinishTally>): FinishPart[] {
  const out: FinishPart[] = [];
  for (const state of FINISH_ORDER) {
    const t = line[state];
    if (t && t.bundles > 0) out.push({ state, bundles: t.bundles, weightG: t.weightG, tone: FINISH_TONE[state] });
  }
  return out;
}

/** One bundle's state for a line, by the domain's rule (used by the tests; the server tallies the same way). */
export function finishStateOf(i: { lineFinish: string | null; bundleFinish: string | null; atVendor: boolean; inProcess: boolean }): FinishState {
  return bundleFinishState(i);
}

export type BundleStepBadge = { kind: "vendor" | "process"; number: string; stepId: string; at: Date | string | number; vendorName: string | null };

/** The bundle page badge: "At vendor JW/.." (job work hold) or "On process step PS/.." (in-house hold); null when the bundle is free. */
export function bundleStepBadge(open: { stepId: string; reason: string; heldAt: Date | string | number; number: string; vendorName: string | null } | null | undefined): BundleStepBadge | null {
  if (!open) return null;
  return { kind: open.reason === "jobwork" ? "vendor" : "process", number: open.number, stepId: open.stepId, at: open.heldAt, vendorName: open.vendorName };
}
