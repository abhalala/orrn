/**
 * Late packing-list entry for line-down hours (arch 52, Q30 follow-up). When the line or the internet
 * was down, the paper packing list is entered afterwards at the time the truck really left: at most
 * 72 hours back, never in the future (a phone clock a little ahead is allowed 2 minutes), with a
 * reason, and a second person approves it (`dispatch_late_entry`). Same rule on the server and in
 * the Complete sheet of web and phone.
 */
export const LATE_DISPATCH_MAX_MS = 72 * 60 * 60 * 1000;
export const LATE_DISPATCH_FUTURE_SKEW_MS = 2 * 60 * 1000;
export const LATE_REASON_MIN = 3;
export const LATE_REASON_MAX = 500;

export type LateDispatchGate = { kind: "ok" } | { kind: "future" } | { kind: "tooOld" } | { kind: "noReason" };

/** Whether a late dispatch time and its reason may be sent (`occurredAt` and `now` in epoch ms). */
export function lateDispatchGate(occurredAt: number, reason: string, now: number): LateDispatchGate {
  if (occurredAt > now + LATE_DISPATCH_FUTURE_SKEW_MS) return { kind: "future" };
  if (now - occurredAt > LATE_DISPATCH_MAX_MS) return { kind: "tooOld" };
  if (reason.trim().length < LATE_REASON_MIN) return { kind: "noReason" };
  return { kind: "ok" };
}
