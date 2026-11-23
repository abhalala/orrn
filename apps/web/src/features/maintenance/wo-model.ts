import { fromZonedInput, toZonedInput } from "@/features/orders/view";

import { createRequestIds, type RequestIds } from "@/features/store/request-id";

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

/** A time as a `datetime-local` input value on the PLANT's clock (`settings.timezone`), whatever zone the browser is in. "" for none. */
export function msToLocalInput(ms: number | null | undefined, timeZone: string): string {
  if (ms == null || !Number.isFinite(ms)) return "";
  return toZonedInput(ms, timeZone);
}

/** A `datetime-local` value typed on the plant's clock back to milliseconds; null for blank or unreadable text. */
export function localInputToMs(text: string, timeZone: string): number | null {
  const ms = fromZonedInput(text.trim(), timeZone);
  return ms != null && Number.isFinite(ms) && ms >= 0 ? ms : null;
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

export type WoProblem = "title" | "labour" | "finishBeforeStart" | "startBad" | "finishBad";

export function formOf(wo: WoEditSource, timeZone: string): WoEditForm {
  return {
    title: wo.title,
    priority: wo.priority,
    assignedTo: wo.assignedTo ?? "",
    cause: wo.cause ?? "",
    workDone: wo.workDone ?? "",
    labour: wo.labourMin > 0 ? String(wo.labourMin) : "",
    startedAt: msToLocalInput(wo.startedAt, timeZone),
    finishedAt: msToLocalInput(wo.finishedAt, timeZone),
  };
}

/**
 * Only what differs from the work order as loaded. `{ ok: true, changes: {} }` means nothing changed.
 * A time is compared at the minute the input shows, so an untouched time is never sent back with its seconds cut off.
 */
export function buildUpdate(wo: WoEditSource, form: WoEditForm, timeZone: string): { ok: true; changes: WoChanges } | { ok: false; problem: WoProblem } {
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
  // Only an empty box clears a time. Text that cannot become a supported time is a field error, never a silent clear.
  if (form.startedAt !== msToLocalInput(wo.startedAt, timeZone)) {
    const ms = localInputToMs(form.startedAt, timeZone);
    if (ms === null && form.startedAt.trim() !== "") return { ok: false, problem: "startBad" };
    changes.startedAt = ms;
  }
  if (form.finishedAt !== msToLocalInput(wo.finishedAt, timeZone)) {
    const ms = localInputToMs(form.finishedAt, timeZone);
    if (ms === null && form.finishedAt.trim() !== "") return { ok: false, problem: "finishBad" };
    changes.finishedAt = ms;
  }
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

/** What a Done or Cancel confirmation was opened against: the order and version the operator saw. */
export type MoveAsk = { to: "done" | "cancelled"; id: string; serverSeq: number; initial: string };

export function openMoveAsk(wo: { id: string; serverSeq: number; workDone: string | null }, to: "done" | "cancelled"): MoveAsk {
  return { to, id: wo.id, serverSeq: wo.serverSeq, initial: to === "done" ? doneDraft(wo.workDone) : "" };
}

/** After a failed move the confirmation stays open, except on a conflict: the reviewed text no longer matches the order. */
export function askAfterMoveError(ask: MoveAsk | null, error: unknown): MoveAsk | null {
  return (error as { data?: { code?: string } } | null)?.data?.code === "CONFLICT" ? null : ask;
}

const FORM_KEYS = ["title", "priority", "assignedTo", "cause", "workDone", "labour", "startedAt", "finishedAt"] as const;

/** The fields the operator touched since the draft was seeded from `base`. */
export function editedKeys(base: WoEditSource, form: WoEditForm, zone: string): (keyof WoEditForm)[] {
  const seed = formOf(base, zone);
  return FORM_KEYS.filter((k) => form[k] !== seed[k]);
}

/** Fields the operator edited that someone else also changed: where the refreshed order differs from the one the draft began on. */
export function conflictingKeys(base: WoEditSource, next: WoEditSource, form: WoEditForm, zone: string): (keyof WoEditForm)[] {
  const was = formOf(base, zone);
  const now = formOf(next, zone);
  return editedKeys(base, form, zone).filter((k) => now[k] !== was[k]);
}

/** The draft laid on the refreshed order: edited fields keep the operator's text, untouched fields take the new values. */
export function rebaseForm(base: WoEditSource, next: WoEditSource, form: WoEditForm, zone: string): WoEditForm {
  const edited = new Set(editedKeys(base, form, zone));
  const now = formOf(next, zone);
  const out = { ...now };
  for (const k of FORM_KEYS) if (edited.has(k)) out[k] = form[k];
  return out;
}

/**
 * Attempts to issue from the store. The request id for the same payload never changes until an outcome is known, and an exact
 * retry skips the local balance check: the store may already have issued the last unit and only the answer got lost.
 */
export function createIssueAttempts(ids: RequestIds = createRequestIds()) {
  const sent = new Set<string>();
  return {
    /** The key for this payload and whether it was already sent (a retry). */
    prepare(signature: string): { clientRequestId: string; retry: boolean } {
      return { clientRequestId: ids.idFor(signature), retry: sent.has(signature) };
    },
    isRetry: (signature: string) => sent.has(signature),
    markSent(signature: string) {
      sent.add(signature);
    },
    /** The outcome is known (saved, or a replay that turned out cancelled): the next submission starts fresh. */
    settle() {
      sent.clear();
      ids.reset();
    },
  };
}

export function issueSignature(itemId: string, qtyMilli: number, workOrderId: string, note: string): string {
  return `${itemId}|${qtyMilli}|${workOrderId}|${note.trim()}`;
}
