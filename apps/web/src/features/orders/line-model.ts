/**
 * The order form's line, as the person typed it, and what is sent to the server for it. The form
 * sends ONE side (pieces or kg); the other side, the basis and the implied kg come back from
 * `orders.quote` / `orders.create` and are only displayed (FP-OP-03/04).
 */
import { kgToG, lengthFromInput, MM_PER_INCH, parseDecimal, type LengthUnit } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { kgFieldText, rateText } from "./format";
import { copyChoiceInput, dieTitle } from "./view";

export type QtyBasis = "pcs" | "kg";
export type WeightBasis = "copy_current" | "band_start";
export type Finish = "none" | "anodise" | "pvd";

export type LineDraft = {
  key: string;
  /** The saved line this draft edits (`orders.update` keeps it by id); absent for a new line. */
  id?: string;
  /**
   * A PL-8 line saved without a committed side: its stored figures, and the draft as first shown.
   * Left untouched it is sent back as stored (not switched to the Wave 1 maths).
   */
  legacy?: { kgG: number; pcs: number | null; shown: string };
  die: { id: string; label: string } | null;
  /** "any" = the die room picks, "copy:<id>", "tier:<n>". */
  copy: string;
  feet: string;
  inches: string;
  mm: string;
  pcsText: string;
  kgText: string;
  /** Which side the person typed last; the other side is the server's quote. */
  basis: QtyBasis | null;
  weightBasis: WeightBasis;
  /** null = untouched: the die's / plant's default from the quote is used. */
  alloy: string | null;
  temper: string | null;
  finish: Finish;
  rate: string;
};

export function newLine(key: string): LineDraft {
  return {
    key,
    die: null,
    copy: "any",
    feet: "",
    inches: "",
    mm: "",
    pcsText: "",
    kgText: "",
    basis: null,
    weightBasis: "copy_current",
    alloy: null,
    temper: null,
    finish: "none",
    rate: "",
  };
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

export type QuoteArgs = {
  /** A saved line: quoted on the basis it was locked with (`orders.quote` `lineId`). */
  lineId?: string;
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
  const { dieInstanceId } = copyChoiceInput(d.copy);
  const base = {
    ...(d.id ? { lineId: d.id } : {}),
    sectionId: d.die.id,
    dieInstanceId,
    cutLengthMm: mm,
    qtyBasis: d.basis,
    weightBasis: d.weightBasis,
  };
  if (d.basis === "pcs") {
    const pcs = parsePieces(d.pcsText);
    return pcs == null ? null : { ...base, pcs };
  }
  const kgG = parseKgG(d.kgText);
  return kgG == null ? null : { ...base, kgG };
}

/** Whether two quote inputs ask the same thing (the quote on screen belongs to what is typed). */
export function sameQuoteArgs(a: QuoteArgs, b: QuoteArgs): boolean {
  const keys = ["lineId", "sectionId", "dieInstanceId", "cutLengthMm", "qtyBasis", "pcs", "kgG", "weightBasis"] as const;
  return keys.every((k) => (a[k] ?? null) === (b[k] ?? null));
}

export type LineProblems = { die?: MessageKey; length?: MessageKey; qty?: MessageKey };

export function lineProblems(d: LineDraft, unit: LengthUnit): LineProblems {
  const out: LineProblems = {};
  if (!d.die) out.die = "orders.form.errors.die";
  if (cutLengthMm(d, unit) == null) out.length = "orders.form.errors.length";
  if (d.basis == null || (d.basis === "pcs" ? parsePieces(d.pcsText) : parseKgG(d.kgText)) == null) out.qty = "orders.form.errors.qty";
  return out;
}

/**
 * One `orders.create` line. Only the typed side of the quantity is sent; alloy and temper only when
 * the person changed them (otherwise the server uses the die's, else the plant's, the same ones the
 * quote showed).
 */
export function toLineInput(d: LineDraft, unit: LengthUnit, withRate: boolean) {
  const args = quoteArgs(d, unit);
  if (!args) throw new Error("line is incomplete");
  const { dieInstanceId, tierRank } = copyChoiceInput(d.copy);
  const alloy = (d.alloy ?? "").trim();
  const temper = (d.temper ?? "").trim();
  const rate = withRate ? parseDecimal(d.rate) : null;
  return {
    sectionId: args.sectionId,
    cutLengthMm: args.cutLengthMm,
    qtyBasis: args.qtyBasis,
    ...(args.pcs != null ? { pcs: args.pcs } : {}),
    ...(args.kgG != null ? { kgG: args.kgG } : {}),
    weightBasis: d.weightBasis,
    ...(dieInstanceId ? { dieInstanceId } : {}),
    ...(tierRank ? { tierRank } : {}),
    ...(alloy ? { alloy } : {}),
    ...(temper ? { temper } : {}),
    finish: d.finish === "none" ? null : d.finish,
    ...(rate != null ? { ratePaise: Math.round(rate * 100) } : {}),
  };
}

/** The length fields a stored length is shown in: feet + inches (to 0.25 in) or mm. */
export function lengthInputOf(mm: number, unit: LengthUnit): Pick<LineDraft, "feet" | "inches" | "mm"> {
  if (unit === "mm") return { feet: "", inches: "", mm: String(Math.round(mm)) };
  const totalInches = Math.round(mm / MM_PER_INCH / 0.25) * 0.25;
  const feet = Math.floor(totalInches / 12);
  const inches = Number((totalInches - feet * 12).toFixed(2));
  return { feet: feet > 0 ? String(feet) : "", inches: inches > 0 ? String(inches) : "", mm: "" };
}

export type StoredLine = {
  lineId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string | null;
  series: string;
  cutLengthMm: number;
  orderedPcs: number | null;
  orderedG: number;
  finish: string | null;
};

export type StoredLineDetail = {
  dieInstanceId: string | null;
  tierRank: number | null;
  qtyBasis: string | null;
  weightBasis: string | null;
  alloy: string | null;
  temper: string | null;
  ratePaise?: number | null;
};

/**
 * A saved line (`orders.get` line + `lineDetails`) as a draft to edit: the side that was committed
 * (pieces or kg) as text, the copy choice, the basis it was locked with. A PL-8 line without a
 * committed side is edited by kg unless it only has pieces.
 */
export function draftFromLine(key: string, line: StoredLine, d: StoredLineDetail, unit: LengthUnit, withRate: boolean): LineDraft {
  const basis: QtyBasis = d.qtyBasis === "pcs" || d.qtyBasis === "kg" ? d.qtyBasis : line.orderedG > 0 || line.orderedPcs == null ? "kg" : "pcs";
  const finish: Finish = line.finish === "anodise" || line.finish === "pvd" ? line.finish : "none";
  const draft: LineDraft = {
    key,
    id: line.lineId,
    die: { id: line.sectionId, label: dieTitle({ sectionCode: line.sectionCode, sectionName: line.sectionName, series: line.series }) },
    copy: d.dieInstanceId ? `copy:${d.dieInstanceId}` : d.tierRank != null ? `tier:${d.tierRank}` : "any",
    ...lengthInputOf(line.cutLengthMm, unit),
    pcsText: basis === "pcs" && line.orderedPcs != null ? String(line.orderedPcs) : "",
    kgText: basis === "kg" ? kgFieldText(line.orderedG) : "",
    basis,
    weightBasis: d.weightBasis === "band_start" ? "band_start" : "copy_current",
    alloy: d.alloy,
    temper: d.temper,
    finish,
    rate: withRate && d.ratePaise != null ? rateText(d.ratePaise) : "",
  };
  if (d.qtyBasis == null) draft.legacy = { kgG: line.orderedG, pcs: line.orderedPcs, shown: shownKey(draft) };
  return draft;
}

function shownKey(d: LineDraft): string {
  const { key: _k, legacy: _l, ...rest } = d;
  return JSON.stringify(rest);
}

/**
 * One `orders.update` line: the saved line's id (a new line has none), only the typed side, and the
 * copy choice spelled out (null unpins: an omitted pin would keep the old one).
 */
export function toLineEditInput(d: LineDraft, unit: LengthUnit, withRate: boolean) {
  const { dieInstanceId, tierRank } = copyChoiceInput(d.copy);
  if (d.legacy && d.id && shownKey(d) === d.legacy.shown) {
    const { qtyBasis: _q, weightBasis: _w, pcs: _p, kgG: _g, ...rest } = toLineInput(d, unit, withRate);
    return { id: d.id, ...rest, kgG: d.legacy.kgG, pcs: d.legacy.pcs, dieInstanceId, tierRank };
  }
  return {
    ...(d.id ? { id: d.id } : {}),
    ...toLineInput(d, unit, withRate),
    dieInstanceId,
    tierRank,
  };
}
