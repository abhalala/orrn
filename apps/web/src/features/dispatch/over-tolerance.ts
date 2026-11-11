import type { MessageKey, Translate } from "@orrn/i18n";

import { tolerancePct, type OverToleranceLine } from "@/features/scan/scan-outcome";

import { dispatchKgText } from "./format";

/** The order-line overdraw state `dispatch.getDispatch` returns while a dispatch can change (Review Focus 5). */
export type OverdrawState = {
  toleranceBp: number;
  lines: { lineId: string; orderNumber: string; lineNo: number; limitG: number; totalG: number; overG: number; covered: boolean }[];
  approval: { id: string; status: "pending" | "approved" | "rejected"; note: string | null } | null;
} | null;

/** "Over +5% on SO-4 line 2: 30.00 kg over" (pl-flow 61, amber). */
export function overLineText(t: Translate, l: Pick<OverToleranceLine, "toleranceBp" | "orderNumber" | "lineNo" | "overG">): string {
  return t("dispatch.overTolerance.line", { pct: tolerancePct(l.toleranceBp), order: l.orderNumber, line: l.lineNo, kg: dispatchKgText(l.overG) });
}

/**
 * The lines over the order with no approval that covers them, and where the ask stands: a manager
 * has been asked (pending), or pressing Dispatch will ask (a decided request named other figures).
 * Null when nothing is over.
 */
export function overdrawView(state: OverdrawState): { lines: OverToleranceLine[]; statusKey: MessageKey } | null {
  if (!state) return null;
  const over = state.lines.filter((l) => !l.covered);
  if (over.length === 0) return null;
  return {
    lines: over.map((l) => ({ lineId: l.lineId, orderNumber: l.orderNumber, lineNo: l.lineNo, toleranceBp: state.toleranceBp, limitG: l.limitG, totalG: l.totalG, overG: l.overG })),
    statusKey: state.approval?.status === "pending" ? "dispatch.overTolerance.pending" : "dispatch.overTolerance.unasked",
  };
}
