import { kgToG, lengthFromInput, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

/**
 * The booking form's model (spec E2 "Native": one line at a time). The form sends ONE side of the
 * quantity (pieces or kg); the other side, the weight basis and the implied kg come back from
 * `orders.quote` and are only displayed (FP-OP-03/04). Mirrors apps/web/src/features/orders/line-model.ts.
 * Pure, so the steps and the payloads are unit-tested.
 */
export type QtyBasis = "pcs" | "kg";
export type WeightBasis = "copy_current" | "band_start";

export type LineDraft = {
  key: string;
  die: { id: string; label: string } | null;
  /** "any" = the die room picks, "copy:<id>", "tier:<n>". */
  copy: string;
  feet: string;
  inches: string;
  mm: string;
  pcsText: string;
  kgText: string;
  /** Which side the person typed; the other side is the server's quote. */
  basis: QtyBasis | null;
  weightBasis: WeightBasis;
};

export type BookingDraft = {
  customer: { id: string; name: string } | null;
  po: string;
  lines: LineDraft[];
  /** Index of the line being filled (0 based). */
  at: number;
  /** Where the person is: the party step, or a line. */
  step: "party" | "line" | "review";
};

export function newLine(key: string): LineDraft {
  return { key, die: null, copy: "any", feet: "", inches: "", mm: "", pcsText: "", kgText: "", basis: "pcs", weightBasis: "copy_current" };
}

export function newDraft(firstKey: string): BookingDraft {
  return { customer: null, po: "", lines: [newLine(firstKey)], at: 0, step: "party" };
}

export function cutLengthMm(d: Pick<LineDraft, "feet" | "inches" | "mm">, unit: LengthUnit): number | null {
  return lengthFromInput({ unit, mm: d.mm, feet: d.feet, inches: d.inches });
}

/** Whole pieces from typed text (at least 1), else null. */
export function parsePieces(text: string): number | null {
  const n = parseDecimal(text);
  return n != null && Number.isInteger(n) && n >= 1 ? n : null;
}

/** Grams from typed kg (to the gram), else null. */
export function parseKgG(text: string): number | null {
  const n = parseDecimal(text);
  if (n == null) return null;
  const g = kgToG(n);
  return g >= 1 ? g : null;
}

/** The `dieInstanceId` / `tierRank` a copy choice ("any", "copy:<id>", "tier:<n>") stands for. */
export function copyChoiceInput(value: string): { dieInstanceId: string | null; tierRank: number | null } {
  if (value.startsWith("copy:")) return { dieInstanceId: value.slice(5), tierRank: null };
  if (value.startsWith("tier:")) {
    const rank = Number(value.slice(5));
    return { dieInstanceId: null, tierRank: Number.isInteger(rank) && rank > 0 ? rank : null };
  }
  return { dieInstanceId: null, tierRank: null };
}

export type QuoteArgs = {
  sectionId: string;
  dieInstanceId: string | null;
  cutLengthMm: number;
  qtyBasis: QtyBasis;
  pcs?: number;
  kgG?: number;
  weightBasis: WeightBasis;
};

/** The `orders.quote` input for this line, or null while it is incomplete. */
export function quoteArgs(d: LineDraft, unit: LengthUnit): QuoteArgs | null {
  if (!d.die || !d.basis) return null;
  const mm = cutLengthMm(d, unit);
  if (mm == null) return null;
  const base = { sectionId: d.die.id, dieInstanceId: copyChoiceInput(d.copy).dieInstanceId, cutLengthMm: mm, qtyBasis: d.basis, weightBasis: d.weightBasis };
  if (d.basis === "pcs") {
    const pcs = parsePieces(d.pcsText);
    return pcs == null ? null : { ...base, pcs };
  }
  const kgG = parseKgG(d.kgText);
  return kgG == null ? null : { ...base, kgG };
}

export type LineProblems = { die?: MessageKey; length?: MessageKey; qty?: MessageKey };

export function lineProblems(d: LineDraft, unit: LengthUnit): LineProblems {
  const out: LineProblems = {};
  if (!d.die) out.die = "orders.form.errors.die";
  if (cutLengthMm(d, unit) == null) out.length = "orders.form.errors.length";
  if (d.basis == null || (d.basis === "pcs" ? parsePieces(d.pcsText) : parseKgG(d.kgText)) == null) out.qty = "orders.form.errors.qty";
  return out;
}

export function lineComplete(d: LineDraft, unit: LengthUnit): boolean {
  return Object.keys(lineProblems(d, unit)).length === 0;
}

/** The party step is done when a customer is picked. The PO may wait (it is needed to confirm, not to book). */
export function partyProblem(d: Pick<BookingDraft, "customer">): MessageKey | null {
  return d.customer ? null : "orders.form.errors.customer";
}

/** The lines the review lists: every line the person filled in. */
export function completeLines(d: BookingDraft, unit: LengthUnit): LineDraft[] {
  return d.lines.filter((l) => lineComplete(l, unit));
}

/** One `orders.create` line. Only the typed side of the quantity is sent; alloy and temper come from the die / plant. */
export function toLineInput(d: LineDraft, unit: LengthUnit) {
  const args = quoteArgs(d, unit);
  if (!args) throw new Error("line is incomplete");
  const { dieInstanceId, tierRank } = copyChoiceInput(d.copy);
  return {
    sectionId: args.sectionId,
    cutLengthMm: args.cutLengthMm,
    qtyBasis: args.qtyBasis,
    ...(args.pcs != null ? { pcs: args.pcs } : {}),
    ...(args.kgG != null ? { kgG: args.kgG } : {}),
    weightBasis: d.weightBasis,
    ...(dieInstanceId ? { dieInstanceId } : {}),
    ...(tierRank ? { tierRank } : {}),
  };
}

/** The whole `orders.create` input, or null while the customer or a line is missing. `clientRequestId` makes a retry safe. */
export function toCreateInput(d: BookingDraft, unit: LengthUnit, clientRequestId: string) {
  if (!d.customer) return null;
  const lines = d.lines;
  if (lines.length === 0 || !lines.every((l) => lineComplete(l, unit))) return null;
  const po = d.po.trim();
  return {
    customerId: d.customer.id,
    ...(po ? { poNumber: po } : {}),
    lines: lines.map((l) => toLineInput(l, unit)),
    clientRequestId,
  };
}

/** Add an empty line after the last and move to it. */
export function addLine(d: BookingDraft, key: string): BookingDraft {
  return { ...d, lines: [...d.lines, newLine(key)], at: d.lines.length, step: "line" };
}

/** Remove a line. The last line cannot be removed (an order has at least one); the position follows. */
export function removeLine(d: BookingDraft, index: number): BookingDraft {
  if (d.lines.length <= 1 || index < 0 || index >= d.lines.length) return d;
  const lines = d.lines.filter((_, i) => i !== index);
  return { ...d, lines, at: Math.min(d.at, lines.length - 1) };
}

export function updateLine(d: BookingDraft, index: number, patch: Partial<LineDraft>): BookingDraft {
  return { ...d, lines: d.lines.map((l, i) => (i === index ? { ...l, ...patch } : l)) };
}

/** Quick lengths for the order line, in feet (inch companies). */
export const QUICK_FEET = [12, 14, 18] as const;
