/** The phone's self-service screens (More > My work): pure rules, no view code and no clock ("today" and "this month" come from the server's summary). */
import type { AppRouter } from "@orrn/server/routers/index";
import type { inferRouterOutputs } from "@trpc/server";

type Out = inferRouterOutputs<AppRouter>;
export type Summary = Out["hr"]["me"]["summary"];
export type Balance = Summary["balances"][number];
export type Request = Out["hr"]["me"]["leave"][number];
export type Kind = Out["hr"]["leave"]["kinds"][number];
export type Payslip = Out["payroll"]["me"]["payslips"][number];

export type TotalKey = "present" | "absent" | "halfDays" | "leavePaid" | "leaveUnpaid" | "weeklyOff" | "holiday" | "notMarked";

/** What the month card shows (each word is `native.hr.<key>`). Present is counted in days, halves allowed. */
export function attendanceFigures(t: Summary["totals"]): { key: TotalKey; value: string }[] {
  return [
    { key: "present", value: String(t.presentHalves / 2) },
    { key: "absent", value: String(t.absent) },
    { key: "halfDays", value: String(t.halfDays) },
    { key: "leavePaid", value: String(t.leavePaid) },
    { key: "leaveUnpaid", value: String(t.leaveUnpaid) },
    { key: "weeklyOff", value: String(t.weeklyOff) },
    { key: "holiday", value: String(t.holiday) },
    { key: "notMarked", value: String(t.notMarked) },
  ];
}

export const daysText = (halves: number): string => String(halves / 2);

export type LeaveForm = { kindId: string; from: string; to: string; halfDay: boolean; reason: string };
export type LeaveError = "needKind" | "needDays";

const isYmd = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** The request the server takes, or the word that says what is missing. A half day is one day. */
export function leaveInput(f: LeaveForm): { ok: true; input: { kindId: string; from: string; to: string; halfDay: boolean; reason: string | null } } | { ok: false; error: LeaveError } {
  if (!f.kindId) return { ok: false, error: "needKind" };
  const from = f.from.trim();
  const to = f.to.trim();
  if (!isYmd(from) || !isYmd(to) || to < from) return { ok: false, error: "needDays" };
  const reason = f.reason.trim();
  return { ok: true, input: { kindId: f.kindId, from, to, halfDay: f.halfDay && from === to, reason: reason === "" ? null : reason.slice(0, 300) } };
}

/** Only a waiting request is cancelled from the phone (the server refuses the rest). */
export const canCancel = (status: string): boolean => status === "pending";

export function statusTone(status: string): "amber" | "green" | "red" | "neutral" {
  return status === "approved" ? "green" : status === "rejected" ? "red" : status === "pending" ? "amber" : "neutral";
}

/** Whether a login with no person behind it: the server answers NOT_FOUND to every `hr.me` read. */
export function isNotLinked(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
}
