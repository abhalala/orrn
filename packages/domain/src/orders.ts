/**
 * Orders arithmetic (FP-OP-03/04/05/07/08/09; C8, C17; ledger D6). Pure numbers: SQL sums the
 * sources (`lib/orders.ts`), this decides. Weights integer grams, lengths mm, kg/12ft thousandths.
 */
import { MM_PER_INCH, type LengthUnit } from "./units";

/** `MM_PER_FOOT x 12 x 10`: grams = pcs x mm x milli x 10 / 36576. */
export const ORDER_GRAMS_DIVISOR = 36_576;

/** Quarter inches in a length stored as whole mm (inch companies type ft + in; storage rounds). */
function quarterInches(mm: number): number {
  return Math.round((mm / MM_PER_INCH) * 4);
}

/**
 * The exact length an inch company meant: whole mm snapped to the nearest quarter inch
 * (3658 mm -> 3657.6 mm = 12 ft). Weight maths for inch companies uses this, so 18 ft at
 * 12.000 kg/12ft is 540.000 kg, not the 539.961 kg the stored 5486 mm gives.
 */
export function inchExactMm(mm: number): number {
  return (quarterInches(mm) * MM_PER_INCH) / 4;
}

function roundHalfUpRatio(num: number, den: number): number {
  if (Number.isSafeInteger(num) && Number.isSafeInteger(den) && den > 0) return Math.floor((2 * num + den) / (2 * den));
  return Math.round(num / den);
}

/**
 * Ordered grams from pieces: `round(pcs x cutLengthMm x basisMilli x 10 / 36576)`.
 * `unit: "inch"` uses the quarter-inch length (`inchExactMm`), evaluated on integers.
 */
export function orderGrams(pcs: number, cutLengthMm: number, basisMilli: number, unit: LengthUnit = "mm"): number {
  if (!(pcs > 0) || !(cutLengthMm > 0) || !(basisMilli > 0)) return 0;
  if (unit === "inch") {
    // mm = q x 6.35, so grams = pcs x q x milli x 63.5 / 36576 = pcs x q x milli x 127 / 73152.
    return roundHalfUpRatio(pcs * quarterInches(cutLengthMm) * basisMilli * 127, 73_152);
  }
  return roundHalfUpRatio(pcs * cutLengthMm * basisMilli * 10, ORDER_GRAMS_DIVISOR);
}

/** Pieces for an ordered kg: `round(kgG x 36576 / (cutLengthMm x basisMilli x 10))`. 0 when it can't be computed. */
export function orderPieces(kgG: number, cutLengthMm: number, basisMilli: number, unit: LengthUnit = "mm"): number {
  if (!(kgG > 0) || !(cutLengthMm > 0) || !(basisMilli > 0)) return 0;
  if (unit === "inch") return roundHalfUpRatio(kgG * 73_152, quarterInches(cutLengthMm) * basisMilli * 127);
  return roundHalfUpRatio(kgG * ORDER_GRAMS_DIVISOR, cutLengthMm * basisMilli * 10);
}

/** Line weight basis: the copy's latest reading, or the band start (`die.weight_min_g`). */
export const WEIGHT_BASES = ["copy_current", "band_start"] as const;
export type WeightBasis = (typeof WEIGHT_BASES)[number];
/** Which side the clerk committed on a line. */
export const QTY_BASES = ["pcs", "kg"] as const;
export type QtyBasis = (typeof QTY_BASES)[number];
/** Line finish (C20: `6061` is an alloy, never a finish). */
export const LINE_FINISHES = ["none", "anodise", "pvd"] as const;
export type LineFinish = (typeof LINE_FINISHES)[number];
/** `sales_order.source`: portal rows are created in `booking` only (C29). */
export const SALES_ORDER_SOURCES = ["office", "portal"] as const;
export type SalesOrderSource = (typeof SALES_ORDER_SOURCES)[number];

/** Baki (C17): `max(0, ordered - dispatched)` in kg and pcs; `over` is what went past the order. */
export function bakiOf(input: { orderedG: number; dispatchedG: number; orderedPcs: number; dispatchedPcs: number }) {
  return {
    bakiG: Math.max(0, input.orderedG - input.dispatchedG),
    bakiPcs: Math.max(0, input.orderedPcs - input.dispatchedPcs),
    overG: Math.max(0, input.dispatchedG - input.orderedG),
    overPcs: Math.max(0, input.dispatchedPcs - input.orderedPcs),
  };
}

/** What a press plan may still take for a line: ordered minus everything already on its way, floored at 0. */
export function planableG(input: {
  orderedG: number;
  dispatchedG: number;
  packedG: number;
  plannedG: number;
  pressedG: number;
  agedG: number;
}): number {
  return Math.max(0, input.orderedG - input.dispatchedG - input.packedG - input.plannedG - input.pressedG - input.agedG);
}

/** Dispatching past ordered + tolerance (bp of ordered) needs `dispatch_overdraw`. Exact integer compare. */
export function overDispatchBeyondTolerance(input: { orderedG: number; dispatchedAfterG: number; toleranceBp: number }): boolean {
  return (input.dispatchedAfterG - input.orderedG) * 10_000 > input.orderedG * input.toleranceBp;
}

export type ConfirmLine = {
  pcs: number | null;
  kgG: number | null;
  cutLengthMm: number | null;
  alloy: string | null;
  temper: string | null;
  dieInstanceId: string | null;
  tierRank: number | null;
};

/**
 * What still blocks `booking -> confirmed` (OP §6): a PO, at least one line, and on each line pcs,
 * kg, cut length, alloy, temper and, when `settings.dieRequiredOnSalesOrder`, a copy or a tier.
 * Codes are stable (`line_{n}_{field}`, 1-based) for the screen to word.
 */
export function confirmBlockers(input: { poNumber: string | null; lines: readonly ConfirmLine[]; dieRequired: boolean }): string[] {
  const out: string[] = [];
  if (!input.poNumber || input.poNumber.trim() === "") out.push("po_number");
  if (input.lines.length === 0) out.push("no_lines");
  input.lines.forEach((l, i) => {
    const n = i + 1;
    if (!(l.pcs && l.pcs > 0)) out.push(`line_${n}_pcs`);
    if (!(l.kgG && l.kgG > 0)) out.push(`line_${n}_kg`);
    if (!(l.cutLengthMm && l.cutLengthMm > 0)) out.push(`line_${n}_length`);
    if (!l.alloy || l.alloy.trim() === "") out.push(`line_${n}_alloy`);
    if (!l.temper || l.temper.trim() === "") out.push(`line_${n}_temper`);
    if (input.dieRequired && !l.dieInstanceId && l.tierRank == null) out.push(`line_${n}_die_or_tier`);
  });
  return out;
}

/**
 * C8: a bundle on a line is `assigned`; with no line, the latest `bundle_transfer` to null makes it
 * `plant` stock; a legacy bundle with no line and no transfer is `unassigned` (not plant stock,
 * cannot go on a dispatch until a transfer assigns it).
 */
export function bundleAllocation(input: {
  salesOrderLineId: string | null;
  latestTransfer: { toSalesOrderLineId: string | null } | null;
}): "assigned" | "plant" | "unassigned" {
  if (input.salesOrderLineId) return "assigned";
  if (input.latestTransfer && input.latestTransfer.toSalesOrderLineId === null) return "plant";
  return "unassigned";
}

export type ReallocationRefusal = "dispatched" | "void" | "held" | "die_mismatch";

export type ReallocationResult =
  | { ok: true; needsApproval: boolean; warnings: "length_mismatch"[]; reasonCodeKind: "reallocate" | null }
  | { ok: false; refusal: Exclude<ReallocationRefusal, "held"> }
  | { ok: false; refusal: "held"; dispatchCode: string | null };

/** Most bundles one `orders.reallocate` call moves (chunked writes; one approval covers them). */
export const MAX_REALLOCATE_BUNDLES = 100;

/**
 * `orders.reallocate` guard (D6, C47; single action, no `bundle.transfer`). Only `available`
 * bundles move. Same die required. A different cut length is allowed with a warning and a reason
 * code of kind `reallocate`. Another customer's line needs an approved `order_reallocate`
 * (the owned-die gate is separate: `assertDieAllowed` with purpose `dispatch`). `target: null`
 * = plant stock. `bundle.customerId` is the current line's customer (null for plant/unassigned).
 */
export function reallocationCheck(input: {
  bundle: { status: string; dieId: string; lengthMm: number; heldOnDispatchCode: string | null; customerId: string | null };
  target: { dieId: string; cutLengthMm: number; customerId: string } | null;
}): ReallocationResult {
  const { bundle, target } = input;
  if (bundle.status === "dispatched") return { ok: false, refusal: "dispatched" };
  if (bundle.status === "void") return { ok: false, refusal: "void" };
  if (bundle.status !== "available") return { ok: false, refusal: "held", dispatchCode: bundle.heldOnDispatchCode };
  if (!target) return { ok: true, needsApproval: false, warnings: [], reasonCodeKind: null };
  if (target.dieId !== bundle.dieId) return { ok: false, refusal: "die_mismatch" };
  const lengthMismatch = target.cutLengthMm !== bundle.lengthMm;
  const needsApproval = bundle.customerId !== null && bundle.customerId !== target.customerId;
  return {
    ok: true,
    needsApproval,
    warnings: lengthMismatch ? ["length_mismatch"] : [],
    reasonCodeKind: lengthMismatch ? "reallocate" : null,
  };
}
