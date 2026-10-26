/**
 * FP-PR-19 (W4-NEXTROWS, review I-1): who the outbox belongs to right now. A list is kept per plant and
 * per person (`outboxKey`), so at a shared tablet the next person never sends the last one's writes. This
 * module (no React) holds the stores, the person and plant that are signed in, and the rule for when a
 * list may be sent:
 *
 * - `flushLease(companyId, userId)` is given only to the list of the person and plant that are signed in
 *   now, never while a sign-out or a plant switch is on the wire;
 * - signing out, another person signing in, or a plant switch aborts the send in flight (`signal`);
 * - `warnLeaving()` tells the person how many changes are still waiting before they leave; the list stays.
 */
import { createOutboxStore, outboxKey, type OutboxStore } from "./outbox";

type Session = { companyId: string; userId: string };
type Storage_ = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const stores = new Map<string, OutboxStore>();
let storageOverride: Storage_ | null | undefined;
let active: (Session & { key: string }) | null = null;
let locked = false;
let controller = new AbortController();
/** `offline`: a sign-out refused for want of a connection (the person stays signed in). */
export type LeaveWhy = "signOut" | "plant" | "offline";
let warner: ((count: number, why: LeaveWhy) => void) | null = null;
let listening = false;

function defaultStorage(): Storage_ | null {
  if (storageOverride !== undefined) return storageOverride;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The one store of this person's list in this plant. */
export function storeFor(companyId: string, userId: string): OutboxStore {
  const key = outboxKey(companyId, userId);
  let s = stores.get(key);
  if (!s) {
    s = createOutboxStore(key, defaultStorage());
    stores.set(key, s);
    listenForOtherTabs();
  }
  return s;
}

/** A second tab on the same tablet writes the same lists: read them again when it does. */
function listenForOtherTabs() {
  if (listening || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  listening = true;
  window.addEventListener("storage", (e) => {
    if (e.key === null) return void stores.forEach((s) => s.reload());
    stores.get(e.key)?.reload();
  });
}

/** Called with who is signed in (null when nobody). A different person or plant aborts what was in flight. */
export function setActiveSession(next: Session | null) {
  const key = next ? outboxKey(next.companyId, next.userId) : null;
  if (key !== (active?.key ?? null)) {
    controller.abort();
    controller = new AbortController();
    locked = false;
  }
  active = next && key ? { ...next, key } : null;
}

/** Sign-out or `company.switch` is about to start: abort the send in flight and send nothing until the new session is known. */
export function beginSessionChange() {
  locked = true;
  controller.abort();
  controller = new AbortController();
}

/** The sign-out or switch did not happen: the same person and plant carry on. */
export function cancelSessionChange() {
  locked = false;
}

export type FlushLease = { signal: AbortSignal; alive(): boolean };

/** Permission to send this list now: only the signed-in person's list of the active plant, and only while nothing is changing. */
export function flushLease(companyId: string, userId: string): FlushLease | null {
  if (locked || !active || active.key !== outboxKey(companyId, userId)) return null;
  const mine = controller;
  const key = active.key;
  return { signal: mine.signal, alive: () => !locked && !mine.signal.aborted && active?.key === key };
}

/** How many changes of the signed-in person's list in the active plant are not sent yet. */
export function waitingToLeave(): number {
  return active ? storeFor(active.companyId, active.userId).get().length : 0;
}

/** The screen that can speak (it has the translator) says how many are waiting. Returns how to undo it. */
export function registerLeaveWarning(fn: (count: number, why: LeaveWhy) => void): () => void {
  warner = fn;
  return () => {
    if (warner === fn) warner = null;
  };
}

/** Before sign-out or a plant switch: warn with the count when changes are still waiting. Returns the count. */
export function warnLeaving(why: LeaveWhy): number {
  const n = waitingToLeave();
  if (n > 0) warner?.(n, why);
  return n;
}

export function resetOutboxSessionForTests(storage?: Storage_ | null) {
  stores.clear();
  storageOverride = storage;
  active = null;
  locked = false;
  controller.abort();
  controller = new AbortController();
  warner = null;
}
