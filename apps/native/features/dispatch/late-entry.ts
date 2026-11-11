import { lateDispatchGate } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { splitInstant, todayIn, zonedEpoch } from "@/features/foundry/melt-times";

/**
 * Arch 52 (web parity, `features/dispatch/late-entry.ts`): the truck left while the line or the internet
 * was down. The phone has no date picker, so the date (YYYY-MM-DD) and the 24 hour time (HH:MM) are
 * typed on the plant's clock and checked with the server's rule: at most 72 hours back, never in the
 * future, with a reason.
 */
export type LateCheck =
  | { kind: "ok"; occurredAt: number; reason: string }
  | { kind: "error"; field: "time" | "reason"; key: MessageKey };

export function lateCheck(date: string, time: string, reason: string, timeZone: string, now: number): LateCheck {
  const occurredAt = zonedEpoch(date, time, timeZone);
  if (occurredAt === null) return { kind: "error", field: "time", key: "dispatch.late.noTime" };
  const gate = lateDispatchGate(occurredAt, reason, now);
  if (gate.kind === "future") return { kind: "error", field: "time", key: "dispatch.late.future" };
  if (gate.kind === "tooOld") return { kind: "error", field: "time", key: "dispatch.late.tooOld" };
  if (gate.kind === "noReason") return { kind: "error", field: "reason", key: "dispatch.late.noReason" };
  return { kind: "ok", occurredAt, reason: reason.trim() };
}

/** The date field starts on today, on the plant's calendar. */
export function lateStartDate(timeZone: string, now: number = Date.now()): string {
  return todayIn(timeZone, now);
}

/** What `dispatch.complete` gets for a late entry (nothing when the switch is off). */
export function lateExtras(check: LateCheck | null): { occurredAt?: number; lateReason?: string } {
  return check?.kind === "ok" ? { occurredAt: check.occurredAt, lateReason: check.reason } : {};
}

/** Review 5: the late time already asked for on this dispatch (`dispatch.getDispatch` `lateEntry`). */
export type LateEntryAsk = { status: "pending" | "approved" | "changed" | "expired"; occurredAt: number; reason: string; approvalId: string };

/** The line the locked late time shows: waiting, approved, or approved for other bundles (review 7). */
export const LATE_STATUS_KEY = {
  pending: "dispatch.late.waitingFor",
  approved: "dispatch.late.approvedFor",
  changed: "dispatch.late.loadChanged",
  expired: "dispatch.late.expired",
} as const satisfies Record<LateEntryAsk["status"], MessageKey>;

/**
 * Review 5: what the Dispatch sheet starts with. A time already asked for (waiting or approved) is
 * filled in and locked, because any other minute asks a manager again; otherwise empty, on today.
 */
export function lateStart(
  ask: LateEntryAsk | null | undefined,
  timeZone: string,
  now: number = Date.now(),
): { late: boolean; date: string; time: string; reason: string; locked: boolean } {
  if (!ask) return { late: false, date: lateStartDate(timeZone, now), time: "", reason: "", locked: false };
  const { date, time } = splitInstant(ask.occurredAt, timeZone);
  return { late: true, date, time, reason: ask.reason, locked: true };
}

/** A locked time is sent as asked, with no 72 hour check here: an approved time stands after the 72 hours. */
export function lockedCheck(ask: LateEntryAsk): LateCheck {
  return { kind: "ok", occurredAt: ask.occurredAt, reason: ask.reason };
}
