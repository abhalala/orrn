/**
 * Recent items for the command palette (owner decision 2026-11-18): the last 8 things opened from the palette or
 * visited, newest first, kept on this device per company and per user. Storage can be missing, full or blocked
 * (private windows, cleared site data), so every read and write is wrapped and a failure means "no recents".
 *
 * Pages and sections store only their key or id: the palette resolves the label (in the current language) and
 * re-applies permission and module gating when it shows them. Remote rows (bundles, dispatches, dies, customers)
 * store the label and route they were opened with.
 */

export type RecentKind = "page" | "section" | "bundle" | "dispatch" | "die" | "customer";

export type RecentItem = {
  kind: RecentKind;
  /** Nav item key (page), section id (section), or the row id (remote rows). */
  ref: string;
  /** Remote rows only: what the row showed when it was opened. */
  label?: string;
  meta?: string;
  mono?: boolean;
  /** Remote rows only: the route that opened it. */
  to?: string;
};

export const RECENT_LIMIT = 8;

const KINDS: readonly RecentKind[] = ["page", "section", "bundle", "dispatch", "die", "customer"];
const MAX_TEXT = 200;

export function recentStorageKey(userId: string, companyId: string): string {
  return `orrn.palette.recent.v1:${userId}:${companyId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** `window.localStorage`, or null when even reaching it throws (blocked site data). */
function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_TEXT ? value : undefined;
}

/** Keeps only well-formed rows; anything else in storage (an old shape, a hand edit) is dropped. */
function clean(raw: unknown): RecentItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RecentItem[] = [];
  const seen = new Set<string>();
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const kind = KINDS.find((k) => k === r.kind);
    const ref = text(r.ref);
    if (!kind || !ref) continue;
    const remote = kind !== "page" && kind !== "section";
    const label = text(r.label);
    const to = text(r.to);
    // A remote row is only useful with its label and a path inside the app.
    if (remote && (!label || !to || !to.startsWith("/") || to.startsWith("//"))) continue;
    const id = `${kind}:${ref}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const item: RecentItem = { kind, ref };
    if (remote) {
      item.label = label;
      item.to = to;
      const meta = text(r.meta);
      if (meta) item.meta = meta;
      if (r.mono === true) item.mono = true;
    }
    out.push(item);
    if (out.length >= RECENT_LIMIT) break;
  }
  return out;
}

export function readRecents(userId: string, companyId: string, storage: StorageLike | null = defaultStorage()): RecentItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(recentStorageKey(userId, companyId));
    return raw ? clean(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

/** Puts `item` first (moving it up if it was already there) and keeps the newest 8. Returns the new list. */
export function pushRecent(
  userId: string,
  companyId: string,
  item: RecentItem,
  storage: StorageLike | null = defaultStorage(),
): RecentItem[] {
  const next = clean([item, ...readRecents(userId, companyId, storage).filter((r) => r.kind !== item.kind || r.ref !== item.ref)]);
  if (!storage) return next;
  try {
    storage.setItem(recentStorageKey(userId, companyId), JSON.stringify(next));
  } catch {
    // Full or blocked storage: the list just is not remembered.
  }
  return next;
}

export function clearRecents(userId: string, companyId: string, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(recentStorageKey(userId, companyId));
  } catch {
    // Nothing to do: the list was not readable either.
  }
}
