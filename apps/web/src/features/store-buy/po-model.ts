/**
 * Pure rules for the purchase order screens: the line drafts a person types, checking them, building
 * the server input, the running totals, and which actions a status shows. No React, no tRPC.
 */
import { poCancellable, poClosableByHand, poLineMoney, poTotals, rateFitsQty, STORE_MAX_DOC_LINES, type StatusTone } from "@orrn/domain";

import { parseQtyMilli, qtyToText, type QtyProblem, type StoreUnit } from "@/features/store/store-qty";

import { gstBpFromText, paiseToText, ratePaiseFromText } from "./money";

export const PO_STATUSES = ["draft", "issued", "part_received", "closed", "cancelled"] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const DEFAULT_GST_TEXT = "18";
export const MAX_PO_LINES = STORE_MAX_DOC_LINES;

/** The tone of a status chip. */
export function poTone(status: string): StatusTone {
  switch (status) {
    case "issued":
      return "blue";
    case "part_received":
      return "amber";
    case "closed":
      return "green";
    default:
      return "neutral";
  }
}

/** One line as typed: the item, and the quantity, rate in rupees and GST percent as text. */
export type LineDraft = { key: string; itemId: string | null; qty: string; rate: string; gst: string };

export type PoLineInput = { itemId: string; qtyMilli: number; ratePaise: number; gstBp: number };

export type LineProblems = { item?: true; qty?: QtyProblem; rate?: true; gst?: true; large?: true; twice?: true };

export function emptyLine(key: string): LineDraft {
  return { key, itemId: null, qty: "", rate: "", gst: DEFAULT_GST_TEXT };
}

export type UnitOf = (itemId: string) => StoreUnit | null;

/** A line's typed values as numbers, or what is wrong with each box. */
export function checkLine(draft: LineDraft, unitOf: UnitOf): { ok: true; line: PoLineInput } | { ok: false; problems: LineProblems } {
  const problems: LineProblems = {};
  if (!draft.itemId) problems.item = true;
  const qty = parseQtyMilli(draft.qty, draft.itemId ? unitOf(draft.itemId) : null);
  if (!qty.ok) problems.qty = qty.problem;
  const rate = ratePaiseFromText(draft.rate);
  if (rate === null) problems.rate = true;
  const gst = gstBpFromText(draft.gst);
  if (gst === null) problems.gst = true;
  if (qty.ok && rate !== null && !rateFitsQty(qty.milli, rate)) problems.large = true;
  if (Object.keys(problems).length > 0 || !draft.itemId || !qty.ok || rate === null || gst === null) return { ok: false, problems };
  return { ok: true, line: { itemId: draft.itemId, qtyMilli: qty.milli, ratePaise: rate, gstBp: gst } };
}

export type HeaderDraft = { vendorId: string | null; deliveryDate: string; terms: string; note: string };

/** A real `YYYY-MM-DD` day (the server's rule). */
export function isDay(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const d = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === text;
}

export type PoInput = {
  vendorId: string;
  deliveryDate: string | null;
  terms: string | null;
  note: string | null;
  lines: PoLineInput[];
};

export type PoFormProblems = {
  vendor?: true;
  date?: true;
  noLines?: true;
  tooMany?: true;
  lines: Record<string, LineProblems>;
};

/** Every header field is always sent: an empty one clears the field on an update. */
export function buildPoInput(header: HeaderDraft, drafts: readonly LineDraft[], unitOf: UnitOf): { ok: true; input: PoInput } | { ok: false; problems: PoFormProblems } {
  const problems: PoFormProblems = { lines: {} };
  if (!header.vendorId) problems.vendor = true;
  const day = header.deliveryDate.trim();
  if (day !== "" && !isDay(day)) problems.date = true;
  if (drafts.length === 0) problems.noLines = true;
  if (drafts.length > MAX_PO_LINES) problems.tooMany = true;
  const lines: PoLineInput[] = [];
  const seen = new Map<string, string>();
  for (const draft of drafts) {
    const checked = checkLine(draft, unitOf);
    const mine: LineProblems = checked.ok ? {} : { ...checked.problems };
    if (draft.itemId) {
      if (seen.has(draft.itemId)) mine.twice = true;
      else seen.set(draft.itemId, draft.key);
    }
    if (Object.keys(mine).length > 0) problems.lines[draft.key] = mine;
    if (checked.ok) lines.push(checked.line);
  }
  const bad = problems.vendor || problems.date || problems.noLines || problems.tooMany || Object.keys(problems.lines).length > 0;
  if (bad || !header.vendorId) return { ok: false, problems };
  const text = (s: string) => s.trim() || null;
  return { ok: true, input: { vendorId: header.vendorId, deliveryDate: day === "" ? null : day, terms: text(header.terms), note: text(header.note), lines } };
}

/** Running totals over the lines that already parse; a half typed line adds nothing yet. */
export function draftTotals(drafts: readonly LineDraft[], unitOf: UnitOf): { amountPaise: number; gstPaise: number; totalPaise: number } {
  const lines: PoLineInput[] = [];
  for (const d of drafts) {
    const c = checkLine(d, unitOf);
    if (c.ok) lines.push(c.line);
  }
  return poTotals(lines);
}

/** One draft line's total in paise, or null while it does not parse. */
export function draftLineTotal(draft: LineDraft, unitOf: UnitOf): number | null {
  const c = checkLine(draft, unitOf);
  return c.ok ? poLineMoney(c.line).totalPaise : null;
}

/** The lines of a draft order as typed text, for editing. */
export function draftsFromPo(lines: readonly { itemId: string; qtyMilli: number; ratePaise: number; gstBp: number }[]): LineDraft[] {
  return lines.map((l, i) => ({
    key: `l${i + 1}`,
    itemId: l.itemId,
    qty: qtyToText(l.qtyMilli),
    rate: paiseToText(l.ratePaise),
    gst: String(l.gstBp / 100),
  }));
}

/** The lines of an approved indent as drafts: the quantity is asked for, the rate is for the person to fill. */
export function draftsFromIndent(lines: readonly { itemId: string; qtyMilli: number }[]): LineDraft[] {
  return lines.map((l, i) => ({ key: `l${i + 1}`, itemId: l.itemId, qty: qtyToText(l.qtyMilli), rate: "", gst: DEFAULT_GST_TEXT }));
}

export type PoActions = { edit: boolean; send: boolean; closeShort: boolean; cancel: boolean; print: true };

/** What a status offers a person who may manage orders (print is for any reader). */
export function poActions(status: string, receivedAny: boolean, canManage: boolean): PoActions {
  const s = status as PoStatus;
  return {
    edit: canManage && s === "draft",
    send: canManage && s === "draft",
    closeShort: canManage && poClosableByHand(s),
    cancel: canManage && poCancellable(s, receivedAny),
    print: true,
  };
}
