import type { StatusTone } from "@orrn/domain";
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

/** A refused Complete in the floor's words when it is about the dispatch rules; null for anything else. */
export function completeRefusalText(t: Translate, error: unknown): string | null {
  const e = (error && typeof error === "object" ? error : {}) as { message?: unknown; data?: { code?: unknown } | null };
  if (e.data?.code !== "PRECONDITION_FAILED" || typeof e.message !== "string") return null;
  if (/rejected for the order line/i.test(e.message)) return t("dispatch.errors.offBandRejected");
  if (/off the order line/i.test(e.message)) return t("dispatch.errors.offBand");
  return null;
}
