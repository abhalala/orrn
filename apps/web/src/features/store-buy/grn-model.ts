import { parseQtyMilli, type QtyProblem, type StoreUnit } from "@/features/store/store-qty";

import { ratePaiseFromText } from "./money";

/** What the GRN form adds for buying (XE store rows 71 and 73): the order line, the rate and what was turned back. */
export type GrnBuyDraft = { poLineId: string | null; rate: string; rejected: string };

export const EMPTY_GRN_BUY: GrnBuyDraft = { poLineId: null, rate: "", rejected: "" };

export type GrnBuyInput =
  | { ok: true; poLineId: string | null; ratePaise: number | null; rejectedMilli: number | null }
  | { ok: false; rate?: "invalid"; rejected?: QtyProblem };

/**
 * An empty rate stays unknown (null: the server takes the order line's rate, or values the GRN at 0 with
 * "no rate"). An empty or zero rejected box sends nothing.
 */
export function grnBuyInput(draft: GrnBuyDraft, unit: StoreUnit | null): GrnBuyInput {
  const rateText = draft.rate.trim();
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
