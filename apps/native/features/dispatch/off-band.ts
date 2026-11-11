import { tolerancePercentText, type StatusTone } from "@orrn/domain";
import type { MessageKey, Translate } from "@orrn/i18n";

/**
 * Q36 decided (owner 2026-10-24): a bundle more than 0.1 kg/12ft off its order line goes on in a
 * needs-approval state. Same reading as the web's `features/dispatch/off-band.ts`: the server says
 * where each row stands and counts them; the phone only draws it.
 */
export type OffBandStatus = "pending" | "approved" | "rejected" | "none";
export type OffBandSummary = { pending: number; rejected: number; unasked: number; approved: number; blocked: boolean };

export const OFF_BAND_TONE: Record<OffBandStatus, StatusTone> = {
  pending: "amber",
  approved: "green",
  rejected: "red",
  none: "amber",
};

export function offBandStatusKey(status: OffBandStatus): MessageKey {
  return `dispatch.offBand.${status}` as MessageKey;
}

/** Why Dispatch is off (rows rejected, then waiting), else what pressing it will ask. */
export function offBandNote(summary: OffBandSummary | null | undefined): { key: MessageKey; count: number } | null {
  if (!summary) return null;
  if (summary.rejected > 0) return { key: "dispatch.offBand.rejectedNote", count: summary.rejected };
  if (summary.pending > 0) return { key: "dispatch.offBand.waiting", count: summary.pending };
  if (summary.unasked > 0) return { key: "dispatch.offBand.unasked", count: summary.unasked };
  return null;
}

/** Dispatch waits while a row is waiting or rejected. */
export function offBandStops(summary: OffBandSummary | null | undefined): boolean {
  return summary?.blocked === true;
}

/** The order-line overdraw state `dispatch.getDispatch` returns while a dispatch can change. */
export type OverdrawState = {
  toleranceBp: number;
  lines: { lineId: string; orderNumber: string; lineNo: number; overG: number; covered: boolean }[];
  approval: { status: "pending" | "approved" | "rejected" } | null;
} | null;

/**
 * pl-flow 61 (web parity, `over-tolerance.ts`): the lines past ordered + tolerance with no approval
 * covering them, and where the ask stands. Null when nothing is over.
 */
export function overdrawLines(state: OverdrawState | undefined): { lines: { lineId: string; orderNumber: string; lineNo: number; overG: number; pct: string }[]; statusKey: MessageKey } | null {
  if (!state) return null;
  const over = state.lines.filter((l) => !l.covered);
  if (over.length === 0) return null;
  return {
    lines: over.map((l) => ({ lineId: l.lineId, orderNumber: l.orderNumber, lineNo: l.lineNo, overG: l.overG, pct: tolerancePercentText(state.toleranceBp) })),
    statusKey: state.approval?.status === "pending" ? "dispatch.overTolerance.pending" : "dispatch.overTolerance.unasked",
  };
}

/**
 * pl-flow 61 (web parity, `complete-sheet.tsx`): the note for the manager goes with Complete only while a
 * line is over ordered + tolerance and something was written. The server fills the request's note only
 * while it has none.
 */
export function overdrawExtras(over: ReturnType<typeof overdrawLines>, note: string): { overdrawNote?: string } {
  return over && note.trim() ? { overdrawNote: note.trim() } : {};
}

/** A refused Complete in the floor's words when it is about the dispatch rules; null for anything else. */
export function completeRefusalText(t: Translate, error: unknown): string | null {
  const e = (error && typeof error === "object" ? error : {}) as { message?: unknown; data?: { code?: unknown } | null };
  if (typeof e.message !== "string") return null;
  // Check N6: an order line was saved while Dispatch ran; pressing again works.
  if (e.data?.code === "CONFLICT") return /^The order was edited while you pressed Dispatch/i.test(e.message) ? t("dispatch.errors.orderEdited") : null;
  if (e.data?.code === "BAD_REQUEST") {
    // Arch 52: the server's own refusals of a late time (the sheet checks the same rule first).
    if (/in the future/i.test(e.message)) return t("dispatch.late.future");
    if (/at most 72 hours/i.test(e.message)) return t("dispatch.late.tooOld");
    if (/reason the packing list is entered late/i.test(e.message)) return t("dispatch.late.noReason");
    if (/needs the time the truck left/i.test(e.message)) return t("dispatch.late.noTime");
    return null;
  }
  if (e.data?.code !== "PRECONDITION_FAILED") return null;
  if (/rejected for the order line/i.test(e.message)) return t("dispatch.errors.offBandRejected");
  if (/off the order line/i.test(e.message)) return t("dispatch.errors.offBand");
  if (/^Over the order balance/i.test(e.message)) return t("dispatch.errors.overdraw");
  if (/^Entered late/i.test(e.message)) return t("dispatch.errors.lateEntry");
  // BACKLOG 70: no vehicle number (the sheet asks first; this is a header cleared meanwhile).
  if (/^No vehicle number/i.test(e.message)) return t("dispatch.vehicleMissing");
  return null;
}
