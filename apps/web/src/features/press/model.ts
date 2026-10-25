/**
 * Pure view models for the press screens (FP-PR, W2-PR-W): the close-gate wording, the station
 * banner for a run state, the counting stepper, the queue split and reorder, and the parsing of
 * what the operator types. No React here, so it is unit-tested directly. Every figure the station
 * shows (recovery, balance, hints) comes from the server (`press.runs.get` / `preview`); nothing
 * here computes one.
 */
import { bpPercent1, formatKg, formatKgTotal, gToKg, parseDecimal, PRESS_QUEUE_REORDERABLE, type CloseGateError, type PressRunStatus } from "@orrn/domain";
import type { MessageKey } from "@orrn/i18n";
import type { Action } from "@/shared/lib/me";

// ---------------------------------------------------------------------------
// Close gates
// ---------------------------------------------------------------------------

export const CLOSE_GATE_CODES = [
  "not_counting",
  "no_close_permission",
  "not_supervisor",
  "no_cast",
  "no_billets",
  "too_many_billets",
  "billet_row_invalid",
  "billet_cast_mismatch",
  "no_input",
  "no_lines",
  "line_without_kg",
  "line_invalid",
  "no_good",
  "good_over_input",
  "pieces_over_pressed_length",
  "no_qc",
  "qc_row_invalid",
  "qc_reason_missing",
  "qc_note_missing",
  "billet_short_reason_missing",
  "time_unconfirmed",
  "late_entry_unapproved",
  "downtime_open",
  "trial_result_missing",
] as const satisfies readonly CloseGateError[];

/** The message key of one gate code (`press.console.gates.<code>`); null for a code this build does not know. */
export function gateKey(code: string): MessageKey | null {
  return (CLOSE_GATE_CODES as readonly string[]).includes(code) ? (`press.console.gates.${code}` as MessageKey) : null;
}

/**
 * The sentences for a refused close: the screen's own words per code (so hi and gu read right), the
 * server's English sentence only for a code this build does not know.
 */
export function gateSentences(codes: readonly string[], t: (key: MessageKey) => string, serverText: readonly string[] = []): string[] {
  return codes.map((code, i) => {
    const key = gateKey(code);
    return key ? t(key) : (serverText[i] ?? code);
  });
}

// ---------------------------------------------------------------------------
// Station banner and actions
// ---------------------------------------------------------------------------

export type Banner = "locked" | "ready" | "running" | "stopped" | "counting" | "logged" | "voided";

/** queued → locked ("Die not issued. Start is locked."); die_issued → ready (Start); the rest by name. */
export function bannerOf(status: PressRunStatus): Banner {
  switch (status) {
    case "queued":
      return "locked";
    case "die_issued":
      return "ready";
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    case "counting":
      return "counting";
    case "logged":
      return "logged";
    case "voided":
      return "voided";
  }
}

/**
 * What a state offers, whoever looks. Who may press it is the button's `<Can>` (`STATION_ACTION`);
 * nothing here reads a role, so a manager (press.close without press.run) is never hidden from
 * a button by a hand-made boolean (review r1 I-1).
 */
export type StationActions = {
  /** Start is offered only when the die is issued; a queued run never has a Start button. */
  start: boolean;
  stop: boolean;
  /** Stopped → running again. */
  resume: boolean;
  count: boolean;
  /** The counting stepper's "Log run" button. */
  logRun: boolean;
  requestReopen: boolean;
  downtime: boolean;
  handover: boolean;
  /** Void before the press started (queued or die issued). */
  void: boolean;
};

export function stationActions(status: PressRunStatus): StationActions {
  const open = status === "die_issued" || status === "running" || status === "stopped" || status === "counting";
  return {
    start: status === "die_issued",
    stop: status === "running",
    resume: status === "stopped",
    count: status === "stopped",
    logRun: status === "counting",
    requestReopen: status === "logged",
    downtime: status === "running" || status === "stopped",
    handover: open,
    void: status === "queued" || status === "die_issued",
  };
}

/**
 * The permission each station button is wrapped in (`<Can do={STATION_ACTION.x}>`), as the server
 * guards the procedure behind it. An array means any of them.
 */
export const STATION_ACTION = {
  start: "press.run",
  stop: "press.run",
  resume: "press.run",
  count: "press.run",
  undoStart: "press.run",
  handover: "press.run",
  downtime: "press.run",
  /** The stepper is shown to anyone who enters (press.run) or logs (press.close) the figures. */
  countingPanel: ["press.run", "press.close"],
  /** Save and next, Save: the entries themselves are press.run writes. */
  saveCount: "press.run",
  logRun: "press.close",
  requestReopen: "press.close",
  /** Server `press.runs.void` is press.close or order.plan (the planner voids a run before it starts). */
  void: ["press.close", "order.plan"],
} as const satisfies Record<string, Action | readonly Action[]>;

/** The station re-reads a running run every 10 s (spec E3); other states only on focus. */
export const RUNNING_POLL_MS = 10_000;
export function pollIntervalFor(status: PressRunStatus | undefined): number | false {
  return status === "running" ? RUNNING_POLL_MS : false;
}

// ---------------------------------------------------------------------------
// Counting stepper
// ---------------------------------------------------------------------------

export const COUNT_STEPS = ["billets", "pieces", "scrap", "rejects", "remark"] as const;
export type CountStep = (typeof COUNT_STEPS)[number];

export type StepState = "done" | "current" | "upcoming";

export function stepStates(current: number): { step: CountStep; state: StepState }[] {
  const at = clampStep(current);
  return COUNT_STEPS.map((step, i) => ({ step, state: i < at ? "done" : i === at ? "current" : "upcoming" }));
}

export function clampStep(n: number): number {
  return Math.min(Math.max(Number.isFinite(n) ? Math.trunc(n) : 0, 0), COUNT_STEPS.length - 1);
}

export function isLastStep(current: number): boolean {
  return clampStep(current) === COUNT_STEPS.length - 1;
}

/** Which step a gate is fixed on; the person is sent there when a close is refused. */
export function stepOfGate(code: string): number {
  switch (code) {
    case "no_cast":
    case "no_billets":
    case "too_many_billets":
    case "billet_row_invalid":
    case "billet_cast_mismatch":
    case "no_input":
    case "billet_short_reason_missing":
      return 0;
    case "no_lines":
    case "line_without_kg":
    case "line_invalid":
    case "no_good":
    case "good_over_input":
    case "pieces_over_pressed_length":
      return 1;
    case "no_qc":
    case "qc_row_invalid":
    case "qc_reason_missing":
    case "qc_note_missing":
      return 3;
    default:
      return COUNT_STEPS.length - 1;
  }
}

// ---------------------------------------------------------------------------
// What the operator types
// ---------------------------------------------------------------------------

/** Typed kg → whole grams, or null for blank / not a number. */
export function kgTextToG(text: string): number | null {
  const n = parseDecimal(text);
  return n === null ? null : Math.round(n * 1000);
}

/** Typed whole number (pieces, billets), or null. */
export function wholeText(text: string): number | null {
  const n = parseDecimal(text);
  return n !== null && Number.isInteger(n) ? n : null;
}

export function gToKgText(g: number | null | undefined): string {
  if (g === null || g === undefined) return "";
  return String(Math.round(g) / 1000);
}

export type BilletDraft = { key: string; lengthText: string; countText: string; kgText: string };
export type LineDraft = {
  key: string;
  /** Known cut length (a plan line); null = the person types it in `cutText`. */
  cutLengthMm: number | null;
  cutText: string;
  pcsText: string;
  kgText: string;
  pressPlanLineId: string | null;
  orderNumber: string | null;
  releasedPcs: number | null;
};
export type QcDraft = { key: string; pcsText: string; kgText: string; reasonCodeId: string; note: string; runLine: number | null };

export type RowIssue = "invalid";
/** Text of a length field to whole mm (null when blank or not a length); supplied by the screen for the company's unit. */
export type LengthParser = (text: string) => number | null;

/** Billet rows for `press.runs.billets`; an `issue` when a row cannot be sent. Blank rows are skipped. */
export function billetRows(rows: readonly BilletDraft[], toMm: LengthParser): { rows: { lengthMm: number | null; count: number; kgG: number }[] } | { issue: RowIssue } {
  const out: { lengthMm: number | null; count: number; kgG: number }[] = [];
  for (const r of rows) {
    if (r.countText.trim() === "" && r.kgText.trim() === "" && r.lengthText.trim() === "") continue;
    const count = wholeText(r.countText);
    const kgG = kgTextToG(r.kgText);
    const lengthMm = r.lengthText.trim() === "" ? null : toMm(r.lengthText);
    if (count === null || kgG === null || (r.lengthText.trim() !== "" && lengthMm === null)) return { issue: "invalid" };
    out.push({ lengthMm, count, kgG });
  }
  return { rows: out };
}

export function lineRows(
  rows: readonly LineDraft[],
  toMm: LengthParser,
): { rows: { cutLengthMm: number; pcs: number; goodG: number; pressPlanLineId: string | null }[] } | { issue: RowIssue } {
  const out: { cutLengthMm: number; pcs: number; goodG: number; pressPlanLineId: string | null }[] = [];
  for (const r of rows) {
    if (r.pcsText.trim() === "" && r.kgText.trim() === "") continue;
    const pcs = wholeText(r.pcsText);
    const goodG = r.kgText.trim() === "" ? 0 : kgTextToG(r.kgText);
    const cutLengthMm = r.cutLengthMm ?? toMm(r.cutText);
    if (pcs === null || goodG === null || cutLengthMm === null) return { issue: "invalid" };
    out.push({ cutLengthMm, pcs, goodG, pressPlanLineId: r.pressPlanLineId });
  }
  return { rows: out };
}

/**
 * Reject rows. A row with 0 pcs and 0 kg is the "none" check (one is sent so the close sees it was
 * asked); a positive row carries its reason and note.
 */
export function qcRows(rows: readonly QcDraft[]): { rows: { pcs: number; kgG: number; reasonCodeId: string | null; note: string | null; runLine: number | null }[] } | { issue: RowIssue } {
  const out: { pcs: number; kgG: number; reasonCodeId: string | null; note: string | null; runLine: number | null }[] = [];
  for (const r of rows) {
    if (r.pcsText.trim() === "" && r.kgText.trim() === "") continue;
    const pcs = r.pcsText.trim() === "" ? 0 : wholeText(r.pcsText);
    const kgG = r.kgText.trim() === "" ? 0 : kgTextToG(r.kgText);
    if (pcs === null || kgG === null) return { issue: "invalid" };
    const positive = pcs > 0 || kgG > 0;
    out.push({ pcs, kgG, reasonCodeId: positive && r.reasonCodeId ? r.reasonCodeId : null, note: positive && r.note.trim() ? r.note.trim() : null, runLine: r.runLine });
  }
  return { rows: out };
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

export type QueueCardLike = { id: string; status: string; urgent?: boolean };

/** On the line = running / stopped / counting; waiting = queued / die_issued (the reorderable ones). */
export function splitQueue<T extends QueueCardLike>(cards: readonly T[]): { onLine: T[]; waiting: T[] } {
  const waiting = cards.filter((c) => (PRESS_QUEUE_REORDERABLE as readonly string[]).includes(c.status));
  const onLine = cards.filter((c) => !(PRESS_QUEUE_REORDERABLE as readonly string[]).includes(c.status));
  return { onLine, waiting };
}

/** The 0-based target index in the waiting list for "up" / "down", or null at the ends. */
export function reorderTarget(waiting: readonly { id: string }[], id: string, dir: "up" | "down"): number | null {
  const at = waiting.findIndex((c) => c.id === id);
  if (at < 0) return null;
  const to = dir === "up" ? at - 1 : at + 1;
  return to < 0 || to >= waiting.length ? null : to;
}

/** The list as it will read after the move (for the optimistic view). */
export function movedOrder<T extends { id: string }>(waiting: readonly T[], id: string, toIndex: number): T[] {
  const from = waiting.findIndex((c) => c.id === id);
  if (from < 0) return [...waiting];
  const next = waiting.filter((c) => c.id !== id);
  next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, waiting[from]!);
  return next;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const kgFromG = (g: number): string => formatKgTotal(gToKg(g));
export const kgFromG3 = (g: number): string => formatKg(gToKg(g), 3);

/** `14:05` on the plant clock; empty for null. */
export function clockOf(at: Date | string | number | null | undefined, timeZone?: string): string {
  if (at === null || at === undefined) return "";
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  }
}

/** `1:12:05` / `12:05` elapsed. */
export function elapsedText(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Recovery in basis points as "78.4" (the server sends `recoveryPct` for a run; reports and Today send bp). */
export function percentOfBp(bp: number | null | undefined): string {
  return bp === null || bp === undefined ? "" : bpPercent1(bp);
}

// ---------------------------------------------------------------------------
// Remark and reading: send each once (review r1 m-3)
// ---------------------------------------------------------------------------

export type TypedNotes = { pressRemark: string; dieRemark: string; readingMilli: number | null };
/** What the server holds now (read fresh, after a failed close). */
export type ServerNotes = { pressRemark: string | null; dieRemark: string | null; lastReadingMilli: number | null };
/** Values a send was started for and not confirmed (the response may have been lost). */
export type NoteAttempts = { reading?: number };

/**
 * What of the last step still has to be sent. The remarks and the reading have no idempotency key
 * on the server, so a retry must not repeat a write that landed: a remark equal to the server's
 * latest is done; a reading is skipped only when a send of that very value was started and the
 * server's latest reading already equals it (a genuinely repeated measurement is still sent).
 */
export function notesToSend(typed: TypedNotes, server: ServerNotes, hasCopy: boolean, attempts: NoteAttempts): { press?: string; die?: string; reading?: number } {
  const out: { press?: string; die?: string; reading?: number } = {};
  const press = typed.pressRemark.trim();
  if (press && press !== (server.pressRemark ?? "")) out.press = press;
  const die = typed.dieRemark.trim();
  if (hasCopy && die && die !== (server.dieRemark ?? "")) out.die = die;
  if (hasCopy && typed.readingMilli !== null && !(attempts.reading === typed.readingMilli && server.lastReadingMilli === typed.readingMilli)) out.reading = typed.readingMilli;
  return out;
}

// ---------------------------------------------------------------------------
// Late entry window
// ---------------------------------------------------------------------------

/** A late entry may start at most this many days ago (server `LATE_ENTRY_MAX_DAYS`). */
export const LATE_ENTRY_DAYS = 7;

/** Why a late entry's times cannot go to the server, or null. */
export function lateEntryIssue(t: { startMs: number | null; stopMs: number | null; nowMs: number }): "order" | "future" | "tooOld" | null {
  if (t.startMs === null || t.stopMs === null || !(t.startMs < t.stopMs)) return "order";
  if (t.stopMs > t.nowMs) return "future";
  if (t.startMs < t.nowMs - LATE_ENTRY_DAYS * 86_400_000) return "tooOld";
  return null;
}
