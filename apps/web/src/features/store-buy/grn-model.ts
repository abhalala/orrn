import { parseQtyMilli, type QtyProblem, type QtyResult, type StoreUnit } from "@/features/store/store-qty";

import { ratePaiseFromText } from "./money";

/** What the GRN form adds for buying (XE store rows 71 and 73): the order line, the rate and what was turned back. */
export type GrnBuyDraft = { poLineId: string | null; rate: string; rejected: string };

export const EMPTY_GRN_BUY: GrnBuyDraft = { poLineId: null, rate: "", rejected: "" };

export type GrnBuyInput =
  | { ok: true; poLineId: string | null; ratePaise: number | null; rejectedMilli: number | null }
  | { ok: false; rate?: "invalid"; rejected?: QtyProblem };

/**
 * An empty rate stays unknown (null: the server takes the order line's rate, or the GRN waits for the
 * office to set one). An empty or zero rejected box sends nothing. Only a person who can set rates
 * (`canRate`, store.rate) ever sends one: for everyone else the rate box is ignored, so the server uses
 * the order's rate or leaves it pending.
 */
export function grnBuyInput(draft: GrnBuyDraft, unit: StoreUnit | null, canRate: boolean): GrnBuyInput {
  const rateText = canRate ? draft.rate.trim() : "";
  const ratePaise = rateText === "" ? null : ratePaiseFromText(rateText);
  const rateBad = rateText !== "" && ratePaise === null;
  let rejectedMilli: number | null = null;
  let rejectedBad: QtyProblem | undefined;
  if (draft.rejected.trim() !== "") {
    const r = parseQtyMilli(draft.rejected, unit);
    if (r.ok) rejectedMilli = r.milli;
    else if (r.problem !== "zero") rejectedBad = r.problem;
  }
  if (rateBad || rejectedBad) return { ok: false, rate: rateBad ? "invalid" : undefined, rejected: rejectedBad };
  return { ok: true, poLineId: draft.poLineId, ratePaise, rejectedMilli };
}

/**
 * The accepted quantity of a GRN. Zero is allowed only when something was rejected (a delivery turned
 * back whole, kept as a record); every other check is the usual quantity check.
 */
export function parseAcceptedMilli(text: string, unit: StoreUnit | null, rejectedMilli: number | null): QtyResult {
  const r = parseQtyMilli(text, unit);
  if (!r.ok && r.problem === "zero" && rejectedMilli !== null && rejectedMilli > 0) return { ok: true, milli: 0 };
  return r;
}

/**
 * True when the draft names an order line the latest open lines no longer have (another delivery or a
 * close used it up). The form keeps the line and blocks the submit: it never turns into a GRN with no
 * order by itself. Only the person drops the order ("Receive without the order") or picks another line.
 */
export function poLineGone(data: { items: { lineId: string }[] } | undefined, poLineId: string | null): boolean {
  return poLineId !== null && data !== undefined && !data.items.some((l) => l.lineId === poLineId);
}

/**
 * Whether a GRN submit is held back by a gone order line. A resend of a submit that got no answer
 * (`signature === unsure`) still goes out unchanged, with the same line, rate and request id: that first
 * submit may be the delivery that used the line up, and the server replays it by its id.
 */
export function grnHeldByGoneLine(lineGone: boolean, signature: string | null, unsure: string | null): boolean {
  return lineGone && (signature === null || signature !== unsure);
}
