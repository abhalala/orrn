/**
 * FP-PR-19 (W4-NEXTROWS): the press station's outbox. While the tablet is offline a station write
 * is kept here instead of failing; when the connection is back the writes go out in the order they
 * were made, each with the SAME idempotency key it was first made with (`clientMutationId`), so a
 * write the server already took is replayed, never repeated. A write the server refuses stays in
 * the list as a conflict with its own message, and later writes of that run wait behind it until
 * the person drops it. The form is never cleared here: the counting draft keeps its own copy.
 *
 * The list logic is pure (tested); `createOutboxStore` keeps it in memory plus localStorage. A list belongs
 * to one person in one plant (`outboxKey`): at a shared tablet the next person never sends it.
 */

/** localStorage key of one person's list in one plant. */
export const outboxKey = (companyId: string, userId: string) => `orrn.press.outbox.${companyId}.${userId}`;

/** Station writes the outbox carries. The first five and `close` carry an idempotency key on the server; the count saves replace the run's rows whole, so sending one twice changes nothing. */
export const OUTBOX_KINDS = ["start", "stop", "count", "resume", "undoStart", "billets", "lines", "scrap", "qc", "close"] as const;
export type OutboxKind = (typeof OUTBOX_KINDS)[number];

/** Saves where the newest replaces an older one of the same run still waiting (full-replace writes). */
const REPLACING: ReadonlySet<OutboxKind> = new Set(["billets", "lines", "qc"]);

export type OutboxItem = {
  /** The write's identity: its `clientMutationId` when it has one, else a key made when it was queued. */
  id: string;
  runId: string;
  runNumber: string | null;
  kind: OutboxKind;
  input: Record<string, unknown>;
  queuedAt: number;
  /** The server's refusal, in the person's words; null while it is waiting. */
  conflict: string | null;
};

export type Outbox = readonly OutboxItem[];

/** Same id twice (the same tap again, offline) keeps one; a newer full-replace save takes the older one's place. */
export function enqueue(box: Outbox, item: OutboxItem): Outbox {
  if (box.some((i) => i.id === item.id)) return box;
  if (REPLACING.has(item.kind)) {
    const at = box.findIndex((i) => i.runId === item.runId && i.kind === item.kind && i.conflict === null);
    if (at >= 0) return box.map((i, n) => (n === at ? { ...item } : i));
  }
  return [...box, item];
}

/** The next write to send: the oldest one whose run has no conflict before it. Null when none. */
export function nextToSend(box: Outbox): OutboxItem | null {
  const blocked = new Set<string>();
  for (const i of box) {
    if (i.conflict !== null) {
      blocked.add(i.runId);
      continue;
    }
    if (!blocked.has(i.runId)) return i;
  }
  return null;
}

export const afterSent = (box: Outbox, id: string): Outbox => box.filter((i) => i.id !== id);
export const afterConflict = (box: Outbox, id: string, message: string): Outbox => box.map((i) => (i.id === id ? { ...i, conflict: message } : i));
export const drop = (box: Outbox, id: string): Outbox => box.filter((i) => i.id !== id);

/** Waiting writes exist but none can go: every run that has them is held behind a refused change. */
export function isBlocked(box: Outbox): boolean {
  return outboxCounts(box).waiting > 0 && nextToSend(box) === null;
}

/**
 * Why a write is being queued, for the words shown: `refused` when the tablet is online and the run
 * has a refused change in the list (this one waits behind it), else `saved` (offline, or waiting its turn).
 */
export function queuedReason(box: Outbox, runId: string, offline: boolean): "refused" | "saved" {
  return !offline && box.some((i) => i.runId === runId && i.conflict !== null) ? "refused" : "saved";
}

export function outboxCounts(box: Outbox, runId?: string) {
  const mine = runId ? box.filter((i) => i.runId === runId) : box;
  return { waiting: mine.filter((i) => i.conflict === null).length, conflicts: mine.filter((i) => i.conflict !== null).length };
}

/**
 * Send what can go, in order. `send` throws on failure; `isOffline(error)` says whether that was the
 * connection (stop, keep everything) or the server refusing (a conflict for that write, carry on with
 * the other runs). Returns the new list and how many went.
 */
export async function flushOutbox(
  box: Outbox,
  send: (item: OutboxItem) => Promise<void>,
  isOffline: (error: unknown) => boolean,
  conflictText: (error: unknown) => string,
  onChange: (box: Outbox) => void = () => {},
  shouldStop: () => boolean = () => false,
): Promise<{ box: Outbox; sent: number; offline: boolean; stopped: boolean }> {
  let cur = box;
  let sent = 0;
  for (let item = nextToSend(cur); item; item = nextToSend(cur)) {
    if (shouldStop()) return { box: cur, sent, offline: false, stopped: true };
    try {
      await send(item);
      cur = afterSent(cur, item.id);
      sent += 1;
    } catch (e) {
      if (shouldStop()) return { box: cur, sent, offline: false, stopped: true };
      if (isOffline(e)) return { box: cur, sent, offline: true, stopped: false };
      cur = afterConflict(cur, item.id, conflictText(e));
    }
    onChange(cur);
  }
  return { box: cur, sent, offline: false, stopped: false };
}

/** What localStorage held, read defensively: anything malformed is left out, never thrown. */
export function parseOutbox(raw: string | null): Outbox {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter(
      (i): i is OutboxItem =>
        typeof i === "object" &&
        i !== null &&
        typeof (i as OutboxItem).id === "string" &&
        typeof (i as OutboxItem).runId === "string" &&
        (OUTBOX_KINDS as readonly string[]).includes((i as OutboxItem).kind) &&
        typeof (i as OutboxItem).input === "object" &&
        (i as OutboxItem).input !== null,
    ).map((i) => ({ ...i, runNumber: i.runNumber ?? null, queuedAt: Number(i.queuedAt) || 0, conflict: typeof i.conflict === "string" ? i.conflict : null }));
  } catch {
    return [];
  }
}

export type OutboxStore = {
  get(): Outbox;
  set(box: Outbox): void;
  /** Read the list again from storage (another tab of this tablet changed it); tells subscribers only when it differs. */
  reload(): void;
  subscribe(fn: () => void): () => void;
};

/** One list per person per plant (`outboxKey`), shared by every station screen of the tab. */
export function createOutboxStore(storageKey: string, storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null): OutboxStore {
  let box: Outbox = [];
  const read = () => {
    try {
      return storage?.getItem(storageKey) ?? null;
    } catch {
      return null;
    }
  };
  box = parseOutbox(read());
  const subs = new Set<() => void>();
  return {
    get: () => box,
    reload() {
      const next = parseOutbox(read());
      if (JSON.stringify(next) === JSON.stringify(box)) return;
      box = next;
      for (const fn of subs) fn();
    },
    set(next) {
      box = next;
      try {
        if (next.length === 0) storage?.removeItem(storageKey);
        else storage?.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Private window or blocked storage: the list still works for this tab.
      }
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

/**
 * Whether the counting draft holds a remark or a die reading the server does not have yet. Those
 * writes carry no idempotency key, so they never wait in the outbox: offline, the run is logged only
 * when there is nothing of them to lose.
 */
export function unsentNotes(
  draft: { pressRemark: string; dieRemark: string; readingText: string },
  data: { run: { pressRemark?: string | null; dieRemark?: string | null } },
): boolean {
  const differs = (typed: string, held: string | null | undefined) => typed.trim() !== "" && typed.trim() !== (held ?? "").trim();
  return differs(draft.pressRemark, data.run.pressRemark) || differs(draft.dieRemark, data.run.dieRemark) || draft.readingText.trim() !== "";
}
