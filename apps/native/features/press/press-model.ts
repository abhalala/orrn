import { bpPercent1, type CloseGateError, type PressRunStatus } from "@orrn/domain";
import type { MessageKey, Translate, TranslateVars } from "@orrn/i18n";

import { noReply } from "@/lib/replay-key";

/**
 * The press on a phone (spec E3 "Native"): run state, the line's queue, downtime start and stop, and the
 * handover. The station itself (start, stop, count, close) is the web tablet, so nothing here sends them.
 * Pure helpers; screens are in features/press/*.tsx.
 */

// ---------------------------------------------------------------------------
// Line state
// ---------------------------------------------------------------------------

export type LineRow = {
  id: string;
  code: string;
  name: string | null;
  /** The running run's number, or null. */
  running: string | null;
  queued: number;
  openDowntime: boolean;
};

export type LineState =
  | { kind: "downtime"; tone: "red" }
  | { kind: "running"; tone: "green"; number: string }
  | { kind: "idle"; tone: "neutral" };

/** What a line is doing now. A stopped press (open downtime) outranks a run number. */
export function lineState(line: Pick<LineRow, "running" | "openDowntime">): LineState {
  if (line.openDowntime) return { kind: "downtime", tone: "red" };
  if (line.running) return { kind: "running", tone: "green", number: line.running };
  return { kind: "idle", tone: "neutral" };
}

// ---------------------------------------------------------------------------
// Run state banner
// ---------------------------------------------------------------------------

export type BannerTone = "neutral" | "blue" | "green" | "amber" | "red";

export type RunBanner = { tone: BannerTone; status: PressRunStatus; headline: MessageKey; detail: MessageKey | null };

/**
 * The banner at the top of a run: the state word and, for a run that cannot start, why (the die is not
 * issued yet). The phone never offers Start, Stop or Count: `detail` names the tablet where they are.
 */
export function runBanner(status: PressRunStatus): RunBanner {
  const headline = `press.console.status.${status}` as MessageKey;
  switch (status) {
    case "queued":
      return { tone: "amber", status, headline, detail: "press.console.startLocked" };
    case "die_issued":
      return { tone: "blue", status, headline, detail: "native.press.atTablet" };
    case "running":
      return { tone: "green", status, headline, detail: "native.press.atTablet" };
    case "stopped":
      return { tone: "amber", status, headline, detail: "native.press.atTablet" };
    case "counting":
      return { tone: "blue", status, headline, detail: "native.press.atTablet" };
    case "logged":
      return { tone: "neutral", status, headline, detail: null };
    case "voided":
      return { tone: "red", status, headline, detail: null };
  }
}

/** Runs that are still open: people can change and downtime can be recorded against them. */
export function isOpenRun(status: PressRunStatus): boolean {
  return status !== "logged" && status !== "voided";
}

/** Handover is allowed on these states (the server's rule); the phone offers it only then. */
export function canHandover(status: PressRunStatus): boolean {
  return status === "die_issued" || status === "running" || status === "stopped" || status === "counting";
}

// ---------------------------------------------------------------------------
// Close gates (read only)
// ---------------------------------------------------------------------------

/**
 * Every close-gate code the server can send and the key that words it in all three languages. Typed as a
 * Record over `CloseGateError`, so a gate the server gains stops compiling here; the tests check each key
 * exists in en, hi and gu.
 */
export const GATE_KEYS: Record<CloseGateError, MessageKey> = {
  not_counting: "press.console.gates.not_counting",
  no_close_permission: "press.console.gates.no_close_permission",
  not_supervisor: "press.console.gates.not_supervisor",
  no_cast: "press.console.gates.no_cast",
  no_billets: "press.console.gates.no_billets",
  too_many_billets: "press.console.gates.too_many_billets",
  billet_row_invalid: "press.console.gates.billet_row_invalid",
  billet_cast_mismatch: "press.console.gates.billet_cast_mismatch",
  no_input: "press.console.gates.no_input",
  no_lines: "press.console.gates.no_lines",
  line_without_kg: "press.console.gates.line_without_kg",
  line_invalid: "press.console.gates.line_invalid",
  no_good: "press.console.gates.no_good",
  good_over_input: "press.console.gates.good_over_input",
  pieces_over_pressed_length: "press.console.gates.pieces_over_pressed_length",
  no_qc: "press.console.gates.no_qc",
  qc_row_invalid: "press.console.gates.qc_row_invalid",
  qc_reason_missing: "press.console.gates.qc_reason_missing",
  qc_note_missing: "press.console.gates.qc_note_missing",
  billet_short_reason_missing: "press.console.gates.billet_short_reason_missing",
  time_unconfirmed: "press.console.gates.time_unconfirmed",
  late_entry_unapproved: "press.console.gates.late_entry_unapproved",
  downtime_open: "press.console.gates.downtime_open",
  trial_result_missing: "press.console.gates.trial_result_missing",
};

/** Start refusals (`canStartRun`): the phone shows why a run waits, never starts it. */
export const START_REFUSAL_KEYS = {
  not_issued: "press.console.startLocked",
  no_open_issue: "press.console.startLocked",
  issue_mismatch: "native.press.errors.dieElsewhere",
  line_busy: "press.console.lineBusy",
} as const satisfies Record<string, MessageKey>;

/** The gate words for the codes a run reports, in the server's order; a code this build does not know shows the generic line. */
export function gateTexts(t: Translate, gates: readonly string[]): string[] {
  return gates.map((g) => ((GATE_KEYS as Record<string, MessageKey>)[g] ? t((GATE_KEYS as Record<string, MessageKey>)[g]!) : t("native.press.gateUnknown")));
}

// ---------------------------------------------------------------------------
// Job cards (queue)
// ---------------------------------------------------------------------------

export type JobLine = { orderNumber: string; cutLengthMm: number; pcs: number; kgG: number; pressedG: number };

export type JobCard = {
  id: string;
  number: string;
  status: PressRunStatus;
  position: number;
  urgent: boolean;
  purpose: string;
  sectionCode: string;
  sectionName: string;
  copyCode: string | null;
  orders: string[];
  lines: JobLine[];
  totals: { pcs: number; kgG: number; pressedG: number };
};

/** The cards whose run is on the press now (running, stopped, counting) come first; the rest wait. */
export function splitCards<T extends { status: PressRunStatus }>(cards: readonly T[]): { onPress: T[]; waiting: T[] } {
  const live = new Set<PressRunStatus>(["running", "stopped", "counting"]);
  return { onPress: cards.filter((c) => live.has(c.status)), waiting: cards.filter((c) => !live.has(c.status)) };
}

// ---------------------------------------------------------------------------
// Figures
// ---------------------------------------------------------------------------

/** "78.4" from basis points, one decimal, half away from zero; null when there is no recovery yet. */
export function recoveryText(bp: number | null | undefined): string | null {
  return bp == null ? null : bpPercent1(bp);
}

// ---------------------------------------------------------------------------
// Scan: a die copy opens its queued run
// ---------------------------------------------------------------------------

export type RunHit = { id: string; number: string; status: string; queuePos?: number | null };

/**
 * A scanned die copy's run to open: the first run of that copy that is still queued or has its die
 * issued, by the order the server listed them. Scanning never starts it. Null when none is waiting.
 */
export function queuedRunFor(runs: readonly RunHit[]): RunHit | null {
  const waiting = runs.filter((r) => r.status === "queued" || r.status === "die_issued");
  if (waiting.length === 0) return null;
  // The die that is issued is the one about to start; otherwise the server's own order.
  return waiting.find((r) => r.status === "die_issued") ?? waiting[0]!;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export type Person = { id: string; name: string; role: string };

/** Who can be the operator or relief (they run the press or log runs) and who can be the supervisor (log runs). */
export function handoverChoices(
  members: readonly { role: string; user: { id: string; name: string } }[],
  canRun: (role: string) => boolean,
  canLog: (role: string) => boolean,
): { crew: Person[]; bosses: Person[] } {
  const person = (m: (typeof members)[number]): Person => ({ id: m.user.id, name: m.user.name, role: m.role });
  const byName = (a: Person, b: Person) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });
  return {
    crew: members.filter((m) => canRun(m.role) || canLog(m.role) || m.role === "operator").map(person).sort(byName),
    bosses: members.filter((m) => canLog(m.role)).map(person).sort(byName),
  };
}

/** The change sent to `press.runs.handover`: only what differs from the run now (a blank choice clears). */
export function handoverChanges(
  before: { operatorId: string | null; reliefOperatorId: string | null; supervisorId: string | null },
  after: { operatorId: string | null; reliefOperatorId: string | null; supervisorId: string | null },
): { operatorId?: string | null; reliefOperatorId?: string | null; supervisorId?: string | null } {
  const out: { operatorId?: string | null; reliefOperatorId?: string | null; supervisorId?: string | null } = {};
  if (after.operatorId !== before.operatorId) out.operatorId = after.operatorId;
  if (after.reliefOperatorId !== before.reliefOperatorId) out.reliefOperatorId = after.reliefOperatorId;
  if (after.supervisorId !== before.supervisorId) out.supervisorId = after.supervisorId;
  return out;
}

// ---------------------------------------------------------------------------
// Downtime
// ---------------------------------------------------------------------------

export type DowntimeReason = { id: string; code: string; label: string; requiresNote: boolean; labelHi?: string | null; labelGu?: string | null; standard?: boolean };

/** Whether the chosen reason still needs a note (`other`, or a reason the plant marked so) and it is missing. */
export function downtimeNoteMissing(reason: Pick<DowntimeReason, "code" | "requiresNote"> | undefined, note: string): boolean {
  return Boolean(reason && (reason.requiresNote || reason.code === "other") && !note.trim());
}

/** Whole minutes between two instants, never below 0. */
export function minutesBetween(from: Date | string | number, to: Date | string | number): number {
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
}

// ---------------------------------------------------------------------------
// Refusals in the person's language
// ---------------------------------------------------------------------------

export type PressRefusal = {
  re: RegExp;
  key: MessageKey;
  vars?: (m: RegExpExecArray) => TranslateVars;
  /** A real message the pattern must match. */
  sample: string;
  /** A fixed piece of the server's text; the test checks the server source still carries it. */
  src: string;
};

/** The server's plain-English refusals for the writes the phone makes, matched and said from our dictionary. Order matters. */
export const PRESS_REFUSALS: readonly PressRefusal[] = [
  { re: /already has downtime running/, key: "native.press.errors.downtimeRunning", sample: "P1 already has downtime running; stop it first", src: "already has downtime running; stop it first" },
  { re: /^Add a note for Other$/, key: "native.press.errors.noteNeeded", sample: "Add a note for Other", src: "Add a note for Other" },
  { re: /^Pick a downtime reason from the list$/, key: "native.press.errors.pickReason", sample: "Pick a downtime reason from the list", src: "Pick a downtime reason from the list" },
  { re: /^That run is closed$/, key: "native.press.errors.runClosed", sample: "That run is closed", src: "That run is closed" },
  { re: /^That run is on another press$/, key: "native.press.errors.otherPress", sample: "That run is on another press", src: "That run is on another press" },
  { re: /^(\S+) is retired$/, key: "native.press.errors.retired", vars: (m) => ({ code: m[1]! }), sample: "P1 is retired", src: "is retired" },
  { re: /^That person is not a member of this plant$/, key: "native.press.errors.notMember", sample: "That person is not a member of this plant", src: "That person is not a member of this plant" },
  { re: /^The operator must be someone who runs the press$/, key: "native.press.errors.operatorRole", sample: "The operator must be someone who runs the press", src: "The operator must be someone who runs the press" },
  { re: /^The supervisor must be someone who can log runs$/, key: "native.press.errors.supervisorRole", sample: "The supervisor must be someone who can log runs", src: "The supervisor must be someone who can log runs" },
  { re: /\bmeanwhile\b|was not saved\. Reload\./, key: "native.press.errors.changed", sample: "PR-3 is being counted now; the handover was not saved. Reload.", src: "was not saved. Reload." },
  { re: /^(\S+) is [a-z ]+; people can change only on an open run$/, key: "native.press.errors.handoverClosed", vars: (m) => ({ number: m[1]! }), sample: "PR-3 is logged; people can change only on an open run", src: "people can change only on an open run" },
  { re: /^Press run not found$|^Press line not found$|^Downtime not found$/, key: "native.press.errors.notFound", sample: "Press run not found", src: "Press run not found" },
];

export type PressError = { text: string; unsure: boolean };

/**
 * A failed press write, said in the person's language. A refusal this build does not know shows the
 * generic sentence (never the server's English). `unsure` is true when orrn never answered: the downtime
 * or handover may have saved, so the screen re-reads rather than retrying blindly.
 */
export function pressError(t: Translate, error: unknown): PressError {
  if (noReply(error)) return { text: t("native.saveUnsureBody"), unsure: true };
  const e = (error && typeof error === "object" ? error : {}) as { data?: { code?: string } | null; message?: unknown };
  const code = e.data?.code;
  const message = typeof e.message === "string" ? e.message : "";
  if (code === "FORBIDDEN") return { text: t("errors.forbidden"), unsure: false };
  if (code === "UNAUTHORIZED") return { text: t("errors.sessionExpired"), unsure: false };
  for (const r of PRESS_REFUSALS) {
    const m = r.re.exec(message);
    if (m) return { text: t(r.key, r.vars?.(m)), unsure: false };
  }
  return { text: code === "CONFLICT" ? t("errors.conflict") : t("errors.generic"), unsure: false };
}
