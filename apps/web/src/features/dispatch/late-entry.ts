/**
 * Arch 52: the Complete sheet's "the truck left earlier" check. The time is typed on the plant's
 * clock (`datetime-local`), read with the plant's zone, and checked with the same rule the server
 * uses (`lateDispatchGate`): at most 72 hours back, never in the future, with a reason.
 */
import { LATE_DISPATCH_MAX_MS, lateDispatchGate } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { fromZonedInput, toZonedInput } from "@/features/orders/view";

/** Review 5: the late time already asked for on this dispatch (`dispatch.getDispatch` `lateEntry`). */
export type LateEntryAsk = { status: "pending" | "approved" | "changed"; occurredAt: number; reason: string; approvalId: string };

/** The line the locked late time shows: waiting, approved, or approved for other bundles (review 7). */
export const LATE_STATUS_KEY = {
  pending: "dispatch.late.waitingFor",
  approved: "dispatch.late.approvedFor",
  changed: "dispatch.late.loadChanged",
} as const satisfies Record<LateEntryAsk["status"], MessageKey>;

export type LateCheck =
  | { kind: "ok"; occurredAt: number; reason: string }
  | { kind: "error"; field: "time" | "reason"; key: MessageKey };

/** Whether the typed time and reason may be sent, and the instant to send. */
export function lateCheck(timeText: string, reason: string, timeZone: string, now: number): LateCheck {
  const occurredAt = fromZonedInput(timeText, timeZone);
  if (occurredAt === null) return { kind: "error", field: "time", key: "dispatch.late.noTime" };
  const gate = lateDispatchGate(occurredAt, reason, now);
  if (gate.kind === "future") return { kind: "error", field: "time", key: "dispatch.late.future" };
  if (gate.kind === "tooOld") return { kind: "error", field: "time", key: "dispatch.late.tooOld" };
  if (gate.kind === "noReason") return { kind: "error", field: "reason", key: "dispatch.late.noReason" };
  return { kind: "ok", occurredAt, reason: reason.trim() };
}

/** The `min` and `max` of the time field: 72 hours back to now, on the plant's clock. */
export function lateBounds(timeZone: string, now: number): { min: string; max: string } {
  return { min: toZonedInput(now - LATE_DISPATCH_MAX_MS, timeZone), max: toZonedInput(now, timeZone) };
}
