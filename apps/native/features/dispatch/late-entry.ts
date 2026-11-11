import { lateDispatchGate } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";

import { todayIn, zonedEpoch } from "@/features/foundry/melt-times";

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
