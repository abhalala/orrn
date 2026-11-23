/**
 * Process steps (XE parity lane JOBWORK, rows 33, 54, 55, 56): one engine for every step that takes
 * bundles in and gives bundles back. A step is either out to a job-work vendor (anodise, powder coat,
 * PVD, machining) or in-house (a finishing line, the draw bench, fabrication). Pure rules only; the
 * server computes every figure from these.
 *
 * Kinds and modules:
 * - `jobwork`   out to a vendor on a delivery challan (GST rule 55); module `jobwork`
 * - `finish`    an in-house anodise or powder-coat line; module `jobwork`
 * - `draw`      the draw bench: tube or rod in, drawn output out; module `drawbench`
 * - `fabricate` cut to length, punch, CNC; module `fabrication`
 *
 * Return modes:
 * - `same`  the same bundles come back (weight after the process, rejects, finish set)
 * - `new`   the inputs are used up and new output bundles are made (new size, cut pieces)
 */
import type { CompanyModule } from "./settings";

export const processKinds = ["jobwork", "finish", "draw", "fabricate"] as const;
export type ProcessKind = (typeof processKinds)[number];

/** What is done on a job-work or finishing step. */
export const finishProcesses = ["anodise", "powder_coat", "pvd", "machining", "other"] as const;
export type FinishProcess = (typeof finishProcesses)[number];

/** Operations on a fabrication job (row 56). */
export const fabricationOps = ["cut", "punch", "cnc", "drill", "other"] as const;
export type FabricationOp = (typeof fabricationOps)[number];

export const processReturnModes = ["same", "new"] as const;
export type ProcessReturnMode = (typeof processReturnModes)[number];

/** `open`: nothing back yet; `partial`: some inputs back; `done`: every input back; `cancelled`: sent back unprocessed before any return. */
export const processStepStatuses = ["open", "partial", "done", "cancelled"] as const;
export type ProcessStepStatus = (typeof processStepStatuses)[number];

/** Finishes a bundle (and an order line) can carry. `none` = mill finish. */
export const bundleFinishes = ["anodise", "powder_coat", "pvd"] as const;
export type BundleFinish = (typeof bundleFinishes)[number];

export const PROCESS_KIND_MODULE: Readonly<Record<ProcessKind, CompanyModule>> = {
  jobwork: "jobwork",
  finish: "jobwork",
  draw: "drawbench",
  fabricate: "fabrication",
};

/** Out to a vendor (bundles leave the plant) or in-house (bundles stay, held while on the line). */
export function isOutKind(kind: ProcessKind): boolean {
  return kind === "jobwork";
}

/** The finish a bundle carries after a process, or null when the process gives no finish. */
export function finishOfProcess(process: string | null | undefined): BundleFinish | null {
  return process === "anodise" || process === "powder_coat" || process === "pvd" ? process : null;
}

/** Number prefix of a step: job-work challans `JW/2026-27/12`, in-house steps `PS/2026-27/12`. */
export function processDocType(kind: ProcessKind): "jobwork" | "process_step" {
  return isOutKind(kind) ? "jobwork" : "process_step";
}

// ---------------------------------------------------------------------------
// Return figures
// ---------------------------------------------------------------------------

/**
 * A coat adds weight (powder coat, anodic film), so a bundle may come back heavier. More than this
 * share of gain on a return is refused as a typing slip (basis points of the input kg).
 */
export const MAX_GAIN_BP = 500;

export type ReturnFiguresInput = {
  /** kg (grams) of the inputs this return closes. */
  inputG: number;
  /** good kg (grams) that came back as stock. */
  outputG: number;
  /** weighed reject kg (grams); goes to plant scrap. */
  rejectG: number;
  /** process scrap kg (grams): drawing ends, cut ends, chips; goes to plant scrap. */
  scrapG: number;
};

export type ReturnFigures = {
  inputG: number;
  outputG: number;
  rejectG: number;
  scrapG: number;
  /** input − output − rejects − scrap. Negative = the coat added weight. */
  lossG: number;
  /** loss as basis points of the input (negative = gain). */
  lossBp: number;
  /** good output as basis points of the input (recovery). */
  yieldBp: number;
};

export type ProcessReturnRefusal = "no_output" | "negative_weight" | "gain_too_high" | "output_over_input";

export function returnFigures(i: ReturnFiguresInput): ReturnFigures {
  const lossG = i.inputG - i.outputG - i.rejectG - i.scrapG;
  return {
    ...i,
    lossG,
    lossBp: i.inputG > 0 ? Math.round((lossG * 10_000) / i.inputG) : 0,
    yieldBp: i.inputG > 0 ? Math.round((i.outputG * 10_000) / i.inputG) : 0,
  };
}

/** Why a return cannot be saved, or null. A gain is allowed only up to MAX_GAIN_BP and only when a coat is put on. */
export function returnRefusal(i: ReturnFiguresInput, opts: { coat: boolean }): ProcessReturnRefusal | null {
  if ([i.inputG, i.outputG, i.rejectG, i.scrapG].some((g) => !Number.isInteger(g) || g < 0)) return "negative_weight";
  if (i.outputG === 0 && i.rejectG === 0 && i.scrapG === 0) return "no_output";
  const f = returnFigures(i);
  if (f.lossG < 0) {
    if (!opts.coat) return "output_over_input";
    if (-f.lossBp > MAX_GAIN_BP) return "gain_too_high";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cost (money is integer paise)
// ---------------------------------------------------------------------------

export type ProcessCost = {
  /** what the vendor (or the line) charges for this return: rate × kg billed. */
  amountPaise: number;
  /** amount per kg of good output; null when nothing good came back. */
  costPerKgPaise: number | null;
};

/**
 * Vendor rate per kg × the kg billed. Job-work vendors bill on the kg they received (the input), so
 * `billedG` is the input of the return; cost per kg spreads that over the good kg that came back.
 */
export function processCost(i: { ratePaisePerKg: number | null; billedG: number; outputG: number }): ProcessCost {
  const rate = i.ratePaisePerKg ?? 0;
  const amountPaise = Math.round((rate * i.billedG) / 1000);
  return { amountPaise, costPerKgPaise: i.outputG > 0 ? Math.round((amountPaise * 1000) / i.outputG) : null };
}

/** Declared value of goods on a challan (rule 55 needs a value even though no tax is paid). */
export function challanValuePaise(valuePaisePerKg: number | null, weightG: number): number {
  return Math.round(((valuePaisePerKg ?? 0) * weightG) / 1000);
}

// ---------------------------------------------------------------------------
// Pending at the vendor, with age
// ---------------------------------------------------------------------------

export const vendorAgeBuckets = ["d0_7", "d8_15", "d16_30", "d30_plus"] as const;
export type VendorAgeBucket = (typeof vendorAgeBuckets)[number];

const DAY_MS = 86_400_000;

/** Whole days since the challan went out (0 on the same day). */
export function daysAtVendor(sentAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - sentAtMs) / DAY_MS));
}

export function vendorAgeBucket(days: number): VendorAgeBucket {
  if (days <= 7) return "d0_7";
  if (days <= 15) return "d8_15";
  if (days <= 30) return "d16_30";
  return "d30_plus";
}

/** Past the expected return date (a `YYYY-MM-DD` on the plant's clock) on `todayYmd`. */
export function isOverdue(expectedReturn: string | null, todayYmd: string): boolean {
  return Boolean(expectedReturn) && expectedReturn! < todayYmd;
}

/**
 * GST rule 55(1)(c) and section 143: goods sent for job work go on a delivery challan and must come
 * back within one year (three years for moulds, dies and tools). Days left before that limit.
 */
export const JOBWORK_RETURN_LIMIT_DAYS = 365;
export function daysToJobworkLimit(sentAtMs: number, nowMs: number): number {
  return JOBWORK_RETURN_LIMIT_DAYS - daysAtVendor(sentAtMs, nowMs);
}

// ---------------------------------------------------------------------------
// The order line's finish requirement
// ---------------------------------------------------------------------------

export type FinishState = "not_needed" | "done" | "at_vendor" | "in_process" | "pending";

/**
 * Has a bundle been through the process its order line asks for? A line with no finish (or `none`)
 * needs nothing. A bundle carrying the line's finish is done; one out at a vendor or on a line is on
 * its way; else it is still waiting.
 */
export function bundleFinishState(i: { lineFinish: string | null | undefined; bundleFinish: string | null | undefined; atVendor: boolean; inProcess: boolean }): FinishState {
  const need = finishOfProcess(i.lineFinish ?? null);
  if (!need) return "not_needed";
  if (i.bundleFinish === need) return "done";
  if (i.atVendor) return "at_vendor";
  if (i.inProcess) return "in_process";
  return "pending";
}

// ---------------------------------------------------------------------------
// Refusals (sentences live in the server's refusal table and in i18n)
// ---------------------------------------------------------------------------

export const processRefusalCodes = [
  "bundle_at_vendor",
  "bundle_in_process",
  "bundle_not_in_stock",
  "bundle_on_dispatch",
  "bundle_off_ledger",
  "bundle_twice",
  "vendor_needed",
  "vendor_inactive",
  "step_closed",
  "input_not_on_step",
  "input_already_back",
  "no_output",
  "negative_weight",
  "gain_too_high",
  "output_over_input",
  "cancel_after_return",
  "no_yard",
  "process_kind_mismatch",
] as const;
export type ProcessRefusalCode = (typeof processRefusalCodes)[number];

/**
 * Spread a step's loss over its input bundles by weight (largest remainder, so the shares add up to
 * the loss exactly). Each input bundle's ledger then closes as − (its kg − its share) used up and
 * − its share lost. A negative loss (a coat's gain) spreads the same way.
 */
export function shareLoss(weightsG: readonly number[], lossG: number): number[] {
  const total = weightsG.reduce((a, b) => a + b, 0);
  if (weightsG.length === 0) return [];
  if (total <= 0) return weightsG.map((_, i) => (i === 0 ? lossG : 0));
  const sign = lossG < 0 ? -1 : 1;
  const abs = Math.abs(lossG);
  const raw = weightsG.map((w) => (abs * w) / total);
  const base = raw.map((r) => Math.floor(r));
  let left = abs - base.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    base[o.i]! += 1;
    left -= 1;
  }
  return base.map((b) => sign * b);
}
