import type { StatusTone } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

/**
 * Q36 decided (owner 2026-10-24): a bundle more than 0.1 kg/12ft off its order line goes on in a
 * needs-approval state. The server says where each row stands (`offBandStatus`) and counts them
 * (`offBand`); the screen only draws it.
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

/**
 * Why Dispatch is off (rows waiting or rejected), else what pressing it will do (rows nobody asked
 * for yet are asked then). Rejected rows come first: they need someone to act.
 */
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
