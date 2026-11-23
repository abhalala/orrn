/**
 * The quote form's line as the person typed it, and what is sent to the server for it (`pricing.preview`,
 * `pricing.quotes.create` / `update`). Pure, so the mapping is unit-tested. Weights are kg text in the form (the
 * plant's unit box converts); the server gets grams. Pieces are never worked out from kg here: the quote line
 * takes the kg the buyer asked for, and pieces only when they were typed.
 *
 * A rate is sent only when the person typed one above the master's rate for the line: sending the stored rate
 * back on an edit could be refused as below the master after the master moved.
 */
import { addDaysYmd, lineAmountPaise, type LengthUnit, type PriceBreakup } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { kgFieldText, rateText } from "@/features/orders/format";
import { cutLengthMm, lengthInputOf, parseKgG, parsePieces, ratePaiseOf, type Finish } from "@/features/orders/line-model";
import { dieTitle } from "@/features/orders/view";

export type Picked = { id: string; label: string };

export type QuoteLineDraft = {
  key: string;
  die: Picked | null;
  feet: string;
  inches: string;
  mm: string;
  pcsText: string;
  kgText: string;
  finish: Finish;
  /** "" = the section's alloy and temper. */
  alloy: string;
  temper: string;
  /** Component master keys picked on this line (the "always" ones are added by the server anyway). */
  componentKeys: string[];
  /** Rupees per kg typed over the master's rate; "" = the master's rate. */
  rate: string;
  note: string;
};

export function newQuoteLine(key: string): QuoteLineDraft {
  return { key, die: null, feet: "", inches: "", mm: "", pcsText: "", kgText: "", finish: "none", alloy: "", temper: "", componentKeys: [], rate: "", note: "" };
}

export type QuoteLineProblems = { die?: MessageKey; length?: MessageKey; kg?: MessageKey; pcs?: MessageKey; rate?: MessageKey };

/** The master's rate for the line (paise per kg) when the preview has one; null while it is not known. */
export function lineProblems(d: QuoteLineDraft, unit: LengthUnit, computedPaise: number | null): QuoteLineProblems {
  const out: QuoteLineProblems = {};
  if (!d.die) out.die = "orders.form.errors.die";
  if (cutLengthMm(d, unit) == null) out.length = "orders.form.errors.length";
  if (parseKgG(d.kgText) == null) out.kg = "price.quotes.form.errors.kg";
  if (d.pcsText.trim() !== "" && parsePieces(d.pcsText) == null) out.pcs = "price.quotes.form.errors.pcs";
  if (d.rate.trim() !== "") {
    const typed = ratePaiseOf(d.rate);
    if (typed == null) out.rate = "orders.form.errors.rate";
    else if (computedPaise != null && typed < computedPaise) out.rate = "price.quotes.form.errors.rateLow";
  }
  return out;
}

export function lineComplete(d: QuoteLineDraft, unit: LengthUnit): boolean {
  return d.die != null && cutLengthMm(d, unit) != null && parseKgG(d.kgText) != null && (d.pcsText.trim() === "" || parsePieces(d.pcsText) != null);
}

const finishOf = (f: Finish): string | null => (f === "none" ? null : f);

/** One `pricing.preview` line, or null while the section or the kg is missing. */
export function previewLineInput(d: QuoteLineDraft) {
  const kgG = parseKgG(d.kgText);
  if (!d.die || kgG == null) return null;
  const pcs = parsePieces(d.pcsText);
  return {
    sectionId: d.die.id,
    kgG,
    ...(pcs != null ? { pcs } : {}),
    ...(finishOf(d.finish) ? { finish: finishOf(d.finish)! } : {}),
    ...(d.alloy.trim() ? { alloy: d.alloy.trim() } : {}),
    ...(d.componentKeys.length > 0 ? { componentKeys: d.componentKeys } : {}),
  };
}

/** One `pricing.quotes.create` / `update` line. Throws for an incomplete line (the form checks first). */
export function toQuoteLineInput(d: QuoteLineDraft, unit: LengthUnit, computedPaise: number | null) {
  const mm = cutLengthMm(d, unit);
  const kgG = parseKgG(d.kgText);
  if (!d.die || mm == null || kgG == null) throw new Error("line is incomplete");
  const pcs = parsePieces(d.pcsText);
  const typed = d.rate.trim() === "" ? null : ratePaiseOf(d.rate);
  return {
    sectionId: d.die.id,
    cutLengthMm: mm,
    kgG,
    ...(pcs != null ? { pcs } : {}),
    finish: finishOf(d.finish),
    ...(d.alloy.trim() ? { alloy: d.alloy.trim() } : {}),
    ...(d.temper.trim() ? { temper: d.temper.trim() } : {}),
    ...(d.componentKeys.length > 0 ? { componentKeys: d.componentKeys } : {}),
    // Only a rate above the master's is a quote rate; at or below it the master's applies.
    ...(typed != null && computedPaise != null && typed > computedPaise ? { ratePaise: typed } : {}),
    ...(d.note.trim() ? { note: d.note.trim() } : {}),
  };
}

/** A priced line of the quote as the preview answered it. */
export type LinePrice = { ok: true; breakup: PriceBreakup } | { ok: false; missing: string[] };

/** The rate shown for a line: the typed one when above the master's, else the master's; null when unknown. */
export function lineRatePaise(d: QuoteLineDraft, price: LinePrice | undefined): number | null {
  if (!price || !price.ok) return null;
  const typed = d.rate.trim() === "" ? null : ratePaiseOf(d.rate);
  return typed != null && typed > price.breakup.computedPaisePerKg ? typed : price.breakup.computedPaisePerKg;
}

export type QuoteTotals = { lines: number; priced: number; missing: number; kgG: number; amountPaise: number };

/** Weight and amount of the quote. `prices[i]` belongs to `drafts[i]`; a line without a price adds weight only. */
export function quoteTotals(drafts: readonly QuoteLineDraft[], prices: readonly (LinePrice | undefined)[]): QuoteTotals {
  const out: QuoteTotals = { lines: drafts.length, priced: 0, missing: 0, kgG: 0, amountPaise: 0 };
  drafts.forEach((d, i) => {
    const kgG = parseKgG(d.kgText) ?? 0;
    out.kgG += kgG;
    const rate = lineRatePaise(d, prices[i]);
    if (rate == null) {
      if (prices[i] && !prices[i]!.ok) out.missing += 1;
      return;
    }
    out.priced += 1;
    out.amountPaise += lineAmountPaise(kgG, rate);
  });
  return out;
}

/** The previewed lines of the drafts that have enough to price, in one list, with each draft's place in it. */
export function previewRequest(drafts: readonly QuoteLineDraft[]) {
  const lines: NonNullable<ReturnType<typeof previewLineInput>>[] = [];
  const slot: (number | null)[] = [];
  for (const d of drafts) {
    const l = previewLineInput(d);
    if (l) {
      slot.push(lines.length);
      lines.push(l);
    } else slot.push(null);
  }
  return { lines, slot };
}

/** The preview answers laid back over the drafts (undefined for a draft that was not asked). */
export function pricesByDraft(slot: readonly (number | null)[], answers: readonly LinePrice[] | undefined): (LinePrice | undefined)[] {
  return slot.map((s) => (s == null || !answers ? undefined : answers[s]));
}

/** The validity date a new quote starts with: its date plus the plant's valid days. */
export function defaultValidUntil(quoteDate: string, validDays: number): string {
  return addDaysYmd(quoteDate, validDays);
}

export type StoredQuoteLine = {
  dieId: string;
  sectionCode: string | null;
  sectionName: string | null;
  cutLengthMm: number;
  pcs: number | null;
  kgG: number;
  finish: string | null;
  alloy: string | null;
  temper: string | null;
  ratePaise: number;
  note: string | null;
  priceBreakup: PriceBreakup | null;
};

/** A saved quote line as a draft to edit. A rate is kept as typed only when it was above the master's. */
export function draftFromQuoteLine(key: string, l: StoredQuoteLine, unit: LengthUnit): QuoteLineDraft {
  const finish: Finish = l.finish === "anodise" || l.finish === "pvd" ? l.finish : "none";
  const computed = l.priceBreakup?.computedPaisePerKg ?? null;
  return {
    key,
    die: { id: l.dieId, label: dieTitle({ sectionCode: l.sectionCode ?? "", sectionName: l.sectionName }) },
    ...lengthInputOf(l.cutLengthMm, unit),
    pcsText: l.pcs != null ? String(l.pcs) : "",
    kgText: kgFieldText(l.kgG),
    finish,
    alloy: l.alloy ?? "",
    temper: l.temper ?? "",
    componentKeys: (l.priceBreakup?.components ?? []).filter((c) => c.basis === "piece" || c.basis === "order").map((c) => c.key),
    rate: computed != null && l.ratePaise > computed ? rateText(l.ratePaise) : "",
    note: l.note ?? "",
  };
}

export type EnquiryForQuote = {
  customerId: string | null;
  customerName: string | null;
  sectionId: string | null;
  sectionCode: string | null;
  kgG: number | null;
};

/** What an enquiry gives a new quote: its customer (when it is one) and a first line from its section and kg. */
export function prefillFromEnquiry(e: EnquiryForQuote, key: string): { customer: Picked | null; line: QuoteLineDraft } {
  const line = newQuoteLine(key);
  if (e.sectionId) line.die = { id: e.sectionId, label: e.sectionCode ?? "" };
  if (e.kgG != null && e.kgG > 0) line.kgText = kgFieldText(e.kgG);
  return { customer: e.customerId ? { id: e.customerId, label: e.customerName ?? "" } : null, line };
}

/** A valid-until date that runs out before the quote date is a form problem. */
export function validityProblem(quoteDate: string, validUntil: string): MessageKey | null {
  if (!validUntil) return "price.quotes.form.errors.validUntil";
  return validUntil < quoteDate ? "price.quotes.form.errors.validBefore" : null;
}
