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

// ---------------------------------------------------------------------------
// Wave 2 (press, FP-PR-07..12, 20, 23..25): close gates and the run's arithmetic. Pure: the server
// reads the rows, calls these, and writes the figures in the close batch (one atomicBatch).
// ---------------------------------------------------------------------------

/** Plan purpose (FP-PR-23). Non-production runs need no sales order line and never move baki. */
export const PRESS_PLAN_PURPOSES = ["production", "die_trial", "sample", "other"] as const;
export type PressPlanPurpose = (typeof PRESS_PLAN_PURPOSES)[number];

/** Most billet rows on one run. */
export const MAX_BILLET_ROWS = 10;
/** Longest reason / note text (billet short, remarks, QC note). */
export const MAX_PRESS_REASON = 500;
/** |server apply − device tap| above this marks the run's time unconfirmed (Q-PR7: 2 min). */
export const PRESS_SKEW_MAX_MS = 2 * 60 * 1000;

/** Half away from zero, integer maths for integer inputs where it can be (no 0.5 float drift). */
function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** Basis points as a one-decimal percent string, half away from zero: 7835 → "78.4", 7545 → "75.5", 286 → "2.9". */
export function bpPercent1(bp: number): string {
  if (!Number.isInteger(bp)) throw new RangeError(`bp must be an integer, got ${bp}`);
  const tenths = Math.sign(bp) * Math.floor((Math.abs(bp) + 5) / 10);
  const sign = tenths < 0 ? "-" : "";
  const a = Math.abs(tenths);
  return `${sign}${Math.floor(a / 10)}.${a % 10}`;
}

/**
 * Run balance (spec E3): input − good − discard − ends − reject, grams, stored at close. Warns when
 * |balance| > `warnBp` of input (settings.press.balanceWarnBp, default 200 = 2 %). Never blocks.
 */
export function balanceG(input: {
  inputG: number;
  goodG: number;
  discardG?: number | null;
  endsG?: number | null;
  rejectG?: number | null;
  warnBp?: number;
}): { balanceG: number; warn: boolean } {
  const b = input.inputG - input.goodG - (input.discardG ?? 0) - (input.endsG ?? 0) - (input.rejectG ?? 0);
  const warnBp = input.warnBp ?? PRESS_BALANCE_WARN_BP;
  return { balanceG: b, warn: input.inputG > 0 && Math.abs(b) * 10_000 > input.inputG * warnBp };
}

/**
 * Theoretical kg hint for typed pieces (never stored): pcs × cut / 12 ft × kg per 12 ft.
 * 12 ft = 144 in = 3,657.6 mm. `kgPer12ftMilli` is grams per 12 ft (the die copy's reading).
 */
export function theoreticalHintG(input: { pcs: number; cutLengthMm: number; kgPer12ftMilli: number | null | undefined }): number | null {
  const { pcs, cutLengthMm, kgPer12ftMilli } = input;
  if (kgPer12ftMilli == null || !(kgPer12ftMilli > 0) || !(pcs > 0) || !(cutLengthMm > 0)) return null;
  // grams = pcs × mm × milli / 3657.6 = pcs × mm × milli × 10 / 36576 (integers, one rounding).
  return roundHalfAway((pcs * cutLengthMm * kgPer12ftMilli * 10) / 36_576);
}

/** True when the device's tap time is more than 2 min from the server's apply time (FP-PR-06, Q-PR7). */
export function skewUnconfirmed(serverMs: number, tapMs: number | null | undefined, maxMs: number = PRESS_SKEW_MAX_MS): boolean {
  if (tapMs == null) return false;
  return Math.abs(serverMs - tapMs) > maxMs;
}

export type CloseRunInput = {
  status: PressRunStatus;
  supervisorId: string | null;
  castId: string | null;
  /** Optional: Σ pcs × cut must not pass it when set. */
  pressedLengthMm?: number | null;
  timeUnconfirmed: boolean;
  /** An approved `press_time` request for this run exists. */
  pressTimeApproved?: boolean;
  lateEntry?: boolean;
  /** An approved `press_late_entry` request for this run exists. */
  lateEntryApproved?: boolean;
  /** Required (1–500) when the cast's BILLET on hand is below Σ billet kg. */
  billetShortReason?: string | null;
  purpose?: PressPlanPurpose;
  /** `die_trial` runs: the supervisor's verdict. */
  trialResult?: "pass" | "fail" | null;
};
export type CloseRunLine = { cutLengthMm: number; pcs: number; goodG: number };
export type CloseBilletRow = { castId: string; count: number; kgG: number };
export type CloseQcRow = { pcs: number; kgG: number; reasonCode: string | null; reasonRequiresNote?: boolean; note?: string | null };
export type CloseDowntimeRow = { stoppedAt: number | null };
export type CloseSettings = { balanceWarnBp?: number };
export type CloseContext = {
  /** The signed-in user pressing Log run. */
  callerId: string;
  /** The caller holds `press.close`. */
  callerCanClose: boolean;
  /** BILLET ledger on hand for the run's cast, grams (read inside the write too). */
  billetOnHandG?: number | null;
  /**
   * W2-FD-S r1: BILLET ledger on hand per cast id, for every cast the billet rows name. When given,
   * "short" is judged per cast (a run using casts A and B charges each its own kg) and wins over
   * `billetOnHandG`.
   */
  billetOnHandByCastG?: Readonly<Record<string, number>> | null;
};

/** Σ billet kg per cast id, in first-seen order (the close posts one ledger row per cast). */
export function billetInputByCast(billets: readonly { castId: string; kgG: number }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const b of billets) out.set(b.castId, (out.get(b.castId) ?? 0) + (b.kgG > 0 ? b.kgG : 0));
  return out;
}

/**
 * Billets short per cast (D22): Σ over casts of the part of each cast's kg its own on hand cannot
 * cover (on hand below zero counts as zero). `short` = any cast short.
 */
function billetShortByCast(billets: readonly { castId?: string; kgG: number }[], byCast: Readonly<Record<string, number>>): { short: boolean; shortG: number } {
  let shortG = 0;
  let short = false;
  for (const [castId, kg] of billetInputByCast(billets.map((b) => ({ castId: b.castId ?? "", kgG: b.kgG })))) {
    const onHand = byCast[castId] ?? 0;
    if (onHand < kg) {
      short = true;
      shortG += kg - Math.max(0, onHand);
    }
  }
  return { short, shortG };
}

export type CloseGateError =
  | "not_counting"
  | "no_close_permission"
  | "not_supervisor"
  | "no_cast"
  | "no_billets"
  | "too_many_billets"
  | "billet_row_invalid"
  | "billet_cast_mismatch"
  | "no_input"
  | "no_lines"
  | "line_without_kg"
  | "line_invalid"
  | "no_good"
  | "good_over_input"
  | "pieces_over_pressed_length"
  | "no_qc"
  | "qc_row_invalid"
  | "qc_reason_missing"
  | "qc_note_missing"
  | "billet_short_reason_missing"
  | "time_unconfirmed"
  | "late_entry_unapproved"
  | "downtime_open"
  | "trial_result_missing";

const validReason = (s: string | null | undefined) => typeof s === "string" && s.trim().length >= 1 && s.trim().length <= MAX_PRESS_REASON;

/**
 * Close gates of a press run (spec E3 "Close gates", one batch). Returns every failing gate (empty
 * = may log). The server repeats the balance-sensitive ones inside the write (BILLET on hand,
 * status). The issue return (C43, `issueAfterLog`) is an effect of the close, not a gate.
 */
export function closeGates(
  run: CloseRunInput,
  lines: readonly CloseRunLine[],
  billets: readonly CloseBilletRow[],
  qc: readonly CloseQcRow[],
  downtime: readonly CloseDowntimeRow[],
  settings: CloseSettings = {},
  ctx?: CloseContext,
): CloseGateError[] {
  void settings; // the balance warn never blocks; kept in the signature for the server's one call.
  const errors: CloseGateError[] = [];
  const add = (e: CloseGateError) => {
    if (!errors.includes(e)) errors.push(e);
  };
  if (run.status !== "counting") add("not_counting");
  if (ctx) {
    if (!ctx.callerCanClose) add("no_close_permission");
    if (run.supervisorId === null || run.supervisorId !== ctx.callerId) add("not_supervisor");
  }
  if (!run.castId) add("no_cast");

  // Billets: 1 … 10 rows, count >= 1, kg > 0 (unweighed kg blocks, Q-PR5); one row at least of the run's cast.
  if (billets.length === 0) add("no_billets");
  if (billets.length > MAX_BILLET_ROWS) add("too_many_billets");
  for (const b of billets) {
    if (!Number.isInteger(b.count) || b.count < 1 || !Number.isInteger(b.kgG) || b.kgG <= 0) add("billet_row_invalid");
  }
  // W2-FD-S r1: rows may name other casts (each is charged its own kg); the run's own cast (the one
  // its bundles carry) must be among them.
  if (run.castId && billets.length > 0 && !billets.some((b) => b.castId === run.castId)) add("billet_cast_mismatch");
  const inputG = billets.reduce((s, b) => s + (b.kgG > 0 ? b.kgG : 0), 0);
  if (!(inputG > 0)) add("no_input");

  // Pieces by cut length: >= 1 row; a row with pieces needs kg; Σ good > 0 and Σ pcs > 0.
  if (lines.length === 0) add("no_lines");
  for (const l of lines) {
    if (!Number.isInteger(l.pcs) || l.pcs < 0 || !Number.isInteger(l.goodG) || l.goodG < 0 || !(l.cutLengthMm > 0)) add("line_invalid");
    if (l.pcs > 0 && l.goodG === 0) add("line_without_kg");
  }
  const goodG = lines.reduce((s, l) => s + l.goodG, 0);
  const pcs = lines.reduce((s, l) => s + l.pcs, 0);
  if (lines.length > 0 && (!(goodG > 0) || !(pcs > 0))) add("no_good");
  if (inputG > 0 && goodG > inputG) add("good_over_input");
  if (run.pressedLengthMm != null && run.pressedLengthMm > 0) {
    const used = lines.reduce((s, l) => s + l.pcs * l.cutLengthMm, 0);
    if (used > run.pressedLengthMm) add("pieces_over_pressed_length");
  }

  // QC: >= 1 row (a zero row says "no rejects"); a positive reject names a reason; `other` a note.
  if (qc.length === 0) add("no_qc");
  for (const q of qc) {
    if (!Number.isInteger(q.pcs) || q.pcs < 0 || !Number.isInteger(q.kgG) || q.kgG < 0) add("qc_row_invalid");
    const positive = q.pcs > 0 || q.kgG > 0;
    if (positive && !q.reasonCode) add("qc_reason_missing");
    if (q.reasonCode && (q.reasonRequiresNote || q.reasonCode === "other") && !validReason(q.note)) add("qc_note_missing");
  }

  // Billet balance: on hand must cover input, else a short reason (D22: the full weighed kg is still
  // debited and the shortfall is recorded on the run and shown on the cast).
  const shortNow = ctx?.billetOnHandByCastG
    ? billetShortByCast(billets, ctx.billetOnHandByCastG).short
    : ctx?.billetOnHandG != null && ctx.billetOnHandG < inputG;
  if (inputG > 0 && shortNow && !validReason(run.billetShortReason)) {
    add("billet_short_reason_missing");
  }
  if (run.timeUnconfirmed && !run.pressTimeApproved) add("time_unconfirmed");
  if (run.lateEntry && !run.lateEntryApproved) add("late_entry_unapproved");
  if (downtime.some((d) => d.stoppedAt == null)) add("downtime_open");
  if (run.purpose === "die_trial" && run.trialResult !== "pass" && run.trialResult !== "fail") add("trial_result_missing");
  return errors;
}

/**
 * The figures the close writes (server only; any client value is ignored). D22: input is Σ billet
 * kg as weighed at the press, and recovery and balance are computed on it (a physical fact). When
 * the cast's billets on hand are less than that, `short` is set and `billetShortG` is the part the
 * store cannot cover (on hand below zero counts as zero); the ledger still debits the full weighed
 * kg and the run records the shortfall with its reason. `inputWeighedG` equals `inputG`.
 */
export function closeFigures(input: {
  billets: readonly { kgG: number; castId?: string }[];
  lines: readonly { goodG: number }[];
  qc: readonly { kgG: number }[];
  discardG?: number | null;
  endsG?: number | null;
  billetOnHandG?: number | null;
  /** W2-FD-S r1: on hand per cast (wins over `billetOnHandG`); short is judged per cast. */
  billetOnHandByCastG?: Readonly<Record<string, number>> | null;
  balanceWarnBp?: number;
}): {
  inputG: number;
  inputWeighedG: number;
  goodG: number;
  rejectG: number;
  recoveryBp: number | null;
  balanceG: number;
  balanceWarn: boolean;
  short: boolean;
  billetShortG: number;
} {
  const inputG = input.billets.reduce((s, b) => s + b.kgG, 0);
  const perCast = input.billetOnHandByCastG ? billetShortByCast(input.billets, input.billetOnHandByCastG) : null;
  const short = perCast ? perCast.short : input.billetOnHandG != null && input.billetOnHandG < inputG;
  const billetShortG = perCast ? perCast.shortG : short ? inputG - Math.max(0, input.billetOnHandG!) : 0;
  const goodG = input.lines.reduce((s, l) => s + l.goodG, 0);
  const rejectG = input.qc.reduce((s, q) => s + q.kgG, 0);
  const bal = balanceG({ inputG, goodG, discardG: input.discardG, endsG: input.endsG, rejectG, warnBp: input.balanceWarnBp });
  return { inputG, inputWeighedG: inputG, goodG, rejectG, recoveryBp: recoveryBp(goodG, inputG), balanceG: bal.balanceG, balanceWarn: bal.warn, short, billetShortG };
}

/**
 * FP-PR-25 queue order: queued / die_issued runs of a line, urgent first, then `queuePos`, then run
 * number. Returns the ids in order. `moveInQueue` gives the new 1-based positions after moving one.
 */
export function sortPressQueue<T extends { id: string; queuePos: number | null; urgent?: boolean; seq: number }>(runs: readonly T[]): T[] {
  return [...runs].sort(
    (a, b) =>
      Number(Boolean(b.urgent)) - Number(Boolean(a.urgent)) ||
      (a.queuePos ?? Number.MAX_SAFE_INTEGER) - (b.queuePos ?? Number.MAX_SAFE_INTEGER) ||
      a.seq - b.seq,
  );
}

export function moveInQueue(ids: readonly string[], id: string, toIndex: number): { id: string; queuePos: number }[] {
  const from = ids.indexOf(id);
  if (from < 0) throw new RangeError(`Run ${id} is not in the queue`);
  const next = ids.filter((x) => x !== id);
  const at = Math.max(0, Math.min(next.length, toIndex));
  next.splice(at, 0, id);
  return next.map((x, i) => ({ id: x, queuePos: i + 1 }));
}

/** Statuses the queue may reorder (a running run never moves). */
export const PRESS_QUEUE_REORDERABLE: readonly PressRunStatus[] = ["queued", "die_issued"];
