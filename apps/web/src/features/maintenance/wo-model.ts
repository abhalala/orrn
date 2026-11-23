import type { WoStatus } from "./model";

/**
 * Pure rules for the work order screens: labour time text, datetime-local values, the update payload with
 * only the changed fields, and the order of the spares candidates. The server stays the authority on every move.
 */

/** "1:30" or "90" to minutes; "" is no entry (null); anything else is "bad". */
export function parseLabour(text: string): number | null | "bad" {
  const t = text.trim();
  if (t === "") return null;
  const hm = /^(\d{1,4}):(\d{1,2})$/.exec(t);
  if (hm) {
    const min = Number(hm[2]);
    if (min > 59) return "bad";
    const total = Number(hm[1]) * 60 + min;
    return total <= 100_000 ? total : "bad";
  }
  if (/^\d{1,6}$/.test(t)) {
    const total = Number(t);
    return total <= 100_000 ? total : "bad";
  }
  return "bad";
}

const two = (n: number) => String(n).padStart(2, "0");

/** A time as a `datetime-local` input value in the browser's own zone: "2026-11-22T14:05". "" for none. */
export function msToLocalInput(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** A `datetime-local` value back to milliseconds; null for blank or unreadable text. */
export function localInputToMs(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const ms = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export type WoEditSource = {
  title: string;
  priority: string;
  assignedTo: string | null;
  cause: string | null;
  workDone: string | null;
  labourMin: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type WoEditForm = {
  title: string;
  priority: string;
  assignedTo: string;
  cause: string;
  workDone: string;
  labour: string;
  startedAt: string;
  finishedAt: string;
};

export type WoChanges = {
  title?: string;
  priority?: "high" | "medium" | "low";
  assignedTo?: string | null;
  cause?: string | null;
  workDone?: string | null;
  labourMin?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
};

export type WoProblem = "title" | "labour" | "finishBeforeStart";

export function formOf(wo: WoEditSource): WoEditForm {
  return {
    title: wo.title,
    priority: wo.priority,
    assignedTo: wo.assignedTo ?? "",
    cause: wo.cause ?? "",
    workDone: wo.workDone ?? "",
    labour: wo.labourMin > 0 ? String(wo.labourMin) : "",
    startedAt: msToLocalInput(wo.startedAt),
    finishedAt: msToLocalInput(wo.finishedAt),
  };
}

/**
 * Only what differs from the work order as loaded. `{ ok: true, changes: {} }` means nothing changed.
 * A time is compared at the minute the input shows, so an untouched time is never sent back with its seconds cut off.
 */
export function buildUpdate(wo: WoEditSource, form: WoEditForm): { ok: true; changes: WoChanges } | { ok: false; problem: WoProblem } {
  const changes: WoChanges = {};
  const title = form.title.trim();
  if (title === "") return { ok: false, problem: "title" };
  if (title !== wo.title) changes.title = title;
  if (form.priority !== wo.priority && (form.priority === "high" || form.priority === "medium" || form.priority === "low")) changes.priority = form.priority;
  if (form.assignedTo !== (wo.assignedTo ?? "")) changes.assignedTo = form.assignedTo === "" ? null : form.assignedTo;
  const cause = form.cause.trim();
  if (cause !== (wo.cause ?? "").trim()) changes.cause = cause === "" ? null : cause;
  const workDone = form.workDone.trim();
  if (workDone !== (wo.workDone ?? "").trim()) changes.workDone = workDone === "" ? null : workDone;
  const labour = parseLabour(form.labour);
  if (labour === "bad") return { ok: false, problem: "labour" };
  // A blank box leaves labour as it is: the server keeps minutes as a plain number, never empty.
  if (labour !== null && labour !== wo.labourMin) changes.labourMin = labour;
  if (form.startedAt !== msToLocalInput(wo.startedAt)) changes.startedAt = localInputToMs(form.startedAt);
  if (form.finishedAt !== msToLocalInput(wo.finishedAt)) changes.finishedAt = localInputToMs(form.finishedAt);
  const start = changes.startedAt !== undefined ? changes.startedAt : wo.startedAt;
  const finish = changes.finishedAt !== undefined ? changes.finishedAt : wo.finishedAt;
  if (start != null && finish != null && finish < start) return { ok: false, problem: "finishBeforeStart" };
  return { ok: true, changes };
}

export function hasChanges(changes: WoChanges): boolean {
  return Object.keys(changes).length > 0;
}

/** The move buttons in a fixed order, only those the server allowed. Cancel always last. */
const MOVE_ORDER = ["in_progress", "waiting_spares", "open", "done", "cancelled"] as const;
export function orderedMoves(moves: readonly string[]): WoStatus[] {
  return MOVE_ORDER.filter((m) => moves.includes(m));
}

/** The text a Done move starts with: what was written already. */
export function doneDraft(workDone: string | null | undefined): string {
  return workDone ?? "";
}
