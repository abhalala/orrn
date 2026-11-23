/** `/me`: the pure rules behind the self-service page (totals in days, the leave form, what a request may do). No view code, no clock. */
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Hr = inferRouterOutputs<AppRouter>["hr"];
export type MeSummary = Hr["me"]["summary"];
export type MyBalance = MeSummary["balances"][number];
export type MyRequest = Hr["me"]["leave"][number];
export type MyDay = Hr["me"]["attendance"]["days"][number];

export const LEAVE_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type LeaveStatus = (typeof LEAVE_STATUSES)[number];

/** Halves of a day as a number of days: 5 -> "2.5". */
export const daysText = (halves: number): string => String(halves / 2);

/** What the month card shows, in days. */
export function attendanceTotals(t: MeSummary["totals"]): { key: "present" | "absent" | "halfDays" | "leavePaid" | "leaveUnpaid" | "weeklyOff" | "holiday" | "notMarked"; value: string }[] {
  return [
    { key: "present", value: daysText(t.presentHalves) },
    { key: "absent", value: String(t.absent) },
    { key: "halfDays", value: String(t.halfDays) },
    { key: "leavePaid", value: String(t.leavePaid) },
    { key: "leaveUnpaid", value: String(t.leaveUnpaid) },
    { key: "weeklyOff", value: String(t.weeklyOff) },
    { key: "holiday", value: String(t.holiday) },
    { key: "notMarked", value: String(t.notMarked) },
  ];
}

/** A day's word: the mark's status, a holiday the plant set, or nothing marked. */
export function dayMark(d: Pick<MyDay, "holiday" | "mark">): "present" | "absent" | "half_day" | "leave" | "weekly_off" | "holiday" | "none" {
  if (d.mark) return d.mark.status;
  return d.holiday ? "holiday" : "none";
}

export type LeaveForm = { kindId: string; from: string; to: string; halfDay: boolean; reason: string };
export type LeaveError = "needKind" | "needDays";

const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export function leaveInput(f: LeaveForm): { ok: true; input: { kindId: string; from: string; to: string; halfDay: boolean; reason: string | null } } | { ok: false; error: LeaveError } {
  if (!f.kindId) return { ok: false, error: "needKind" };
  if (!isYmd(f.from) || !isYmd(f.to) || f.to < f.from) return { ok: false, error: "needDays" };
  const reason = f.reason.trim();
  return { ok: true, input: { kindId: f.kindId, from: f.from, to: f.to, halfDay: f.halfDay && f.from === f.to, reason: reason === "" ? null : reason.slice(0, 300) } };
}

/** Only a waiting request can be cancelled here; the server refuses the rest. */
export const canCancel = (status: string): boolean => status === "pending";

export function statusTone(status: string): "amber" | "green" | "red" | "neutral" {
  return status === "approved" ? "green" : status === "rejected" ? "red" : status === "pending" ? "amber" : "neutral";
}
