/**
 * Press run and press plan state machines (integration plan §2, C6/C7; FP-OP-11..13, FP-PR-05).
 * `plans.release` is the only insert of a `queued` run; die issue moves it to `die_issued`;
 * start refuses anything else. Wave 2 (press) adds the counting/close gates on top.
 */

export const PRESS_RUN_STATUSES = ["queued", "die_issued", "running", "stopped", "counting", "logged", "voided"] as const;
export type PressRunStatus = (typeof PRESS_RUN_STATUSES)[number];

export const PRESS_RUN_EVENTS = [
  "issue", // die room issues a copy (queued -> die_issued)
  "unissue", // issue returned / cancelled before start (die_issued -> queued)
  "start", // server time
  "stop",
  "resume", // stopped -> running (pause; FP-PR acceptance D8)
  "undoStart", // running -> die_issued before any count (D8)
  "count", // stopped -> counting
  "close", // counting -> logged (press.close, supervisor)
  "reopen", // logged -> counting (press_reopen approved, ageing has not loaded)
  "void", // queued | die_issued -> voided
] as const;
export type PressRunEvent = (typeof PRESS_RUN_EVENTS)[number];

const RUN_MOVES: Record<PressRunEvent, { from: readonly PressRunStatus[]; to: PressRunStatus }> = {
  issue: { from: ["queued"], to: "die_issued" },
  unissue: { from: ["die_issued"], to: "queued" },
  start: { from: ["die_issued"], to: "running" },
  stop: { from: ["running"], to: "stopped" },
  resume: { from: ["stopped"], to: "running" },
  undoStart: { from: ["running"], to: "die_issued" },
  count: { from: ["stopped"], to: "counting" },
  close: { from: ["counting"], to: "logged" },
  reopen: { from: ["logged"], to: "counting" },
  void: { from: ["queued", "die_issued"], to: "voided" },
};

export function pressRunNext(from: PressRunStatus, event: PressRunEvent): PressRunStatus | null {
  const move = RUN_MOVES[event];
  return move.from.includes(from) ? move.to : null;
}

/** Statuses `event` accepts (for the write's WHERE). */
export function pressRunFrom(event: PressRunEvent): readonly PressRunStatus[] {
  return RUN_MOVES[event].from;
}

/** Runs that still hold a line or a copy (not logged, not voided). */
export function isOpenPressRun(status: PressRunStatus): boolean {
  return status !== "logged" && status !== "voided";
}

export type StartRefusal = "not_issued" | "no_open_issue" | "issue_mismatch" | "line_busy";

/**
 * Start lock (FP-PR-04): the run must be `die_issued` and an open issue must match its copy and
 * line. One `running` run per line.
 */
export function canStartRun(input: {
  run: { status: PressRunStatus; dieInstanceId: string | null; pressLineId: string | null };
  openIssue: { dieInstanceId: string; pressLineId: string } | null;
  lineHasRunningRun: boolean;
}): { ok: true } | { ok: false; refusal: StartRefusal } {
  if (input.run.status !== "die_issued") return { ok: false, refusal: "not_issued" };
  if (!input.openIssue) return { ok: false, refusal: "no_open_issue" };
  if (
    input.openIssue.dieInstanceId !== input.run.dieInstanceId ||
    (input.run.pressLineId !== null && input.openIssue.pressLineId !== input.run.pressLineId)
  ) {
    return { ok: false, refusal: "issue_mismatch" };
  }
  if (input.lineHasRunningRun) return { ok: false, refusal: "line_busy" };
  return { ok: true };
}

/** Recovery in basis points, half away from zero (server only; a client value is ignored). 234.2 / 310.4 kg = 7545. */
export function recoveryBp(goodG: number, inputG: number): number | null {
  if (!(inputG > 0)) return null;
  const x = (goodG * 10_000) / inputG;
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** `settings.press.balanceWarnBp` default: a run whose unexplained balance passes 2 % of input warns. */
export const PRESS_BALANCE_WARN_BP = 200;

// ---------------------------------------------------------------------------
// Press plan (FP-OP-11..13)
// ---------------------------------------------------------------------------

export const PRESS_PLAN_STATUSES = ["draft", "released", "closed", "cancelled"] as const;
export type PressPlanStatus = (typeof PRESS_PLAN_STATUSES)[number];

/** Longest plan window: 24 hours (Q-OP-11). */
export const PRESS_PLAN_MAX_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PlanRefusal = "not_draft" | "window" | "empty" | "over_planable" | "not_released" | "runs_started" | "runs_open";

/** draft -> released: window <= 24 h and ends after it starts, at least one die with a line. */
export function canReleasePlan(input: {
  status: PressPlanStatus;
  windowStartMs: number;
  windowEndMs: number;
  dieCount: number;
  lineCount: number;
}): { ok: true } | { ok: false; refusal: PlanRefusal } {
  if (input.status !== "draft") return { ok: false, refusal: "not_draft" };
  const span = input.windowEndMs - input.windowStartMs;
  if (!(span > 0) || span > PRESS_PLAN_MAX_WINDOW_MS) return { ok: false, refusal: "window" };
  if (input.dieCount < 1 || input.lineCount < 1) return { ok: false, refusal: "empty" };
  return { ok: true };
}

/**
 * released -> cancelled only while every run is still `queued` (none issued, none started);
 * released -> closed once every run is logged or voided. draft -> cancelled any time.
 */
export function planNextOnRuns(
  status: PressPlanStatus,
  runStatuses: readonly PressRunStatus[],
  want: "cancel" | "close",
): { ok: true; to: PressPlanStatus } | { ok: false; refusal: PlanRefusal } {
  if (want === "cancel") {
    if (status === "draft") return { ok: true, to: "cancelled" };
    if (status !== "released") return { ok: false, refusal: "not_released" };
    if (runStatuses.some((s) => s !== "queued" && s !== "voided")) return { ok: false, refusal: "runs_started" };
    return { ok: true, to: "cancelled" };
  }
  if (status !== "released") return { ok: false, refusal: "not_released" };
  if (runStatuses.some(isOpenPressRun)) return { ok: false, refusal: "runs_open" };
  return { ok: true, to: "closed" };
}
