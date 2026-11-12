/**
 * Name matching shared with the server resolvers (plan B4). `nameKey` must stay equal to `nameKey` in
 * packages/server/src/lib/purchase.ts: NFKC, lower case, letters and digits only. A parity test lives in the server.
 */

export function nameKey(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Levenshtein distance, stopping once it passes `max` (returns max + 1). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= y.length; j++) {
      const cost = x[i - 1] === y[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + cost);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[y.length]!;
}

/** Length of the shared leading run of two keys. */
export function sharedPrefix(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

export type NameEntry = { id: string; key: string; label: string };
export type NameMatch =
  | { kind: "exact"; ids: string[] }
  | { kind: "near"; options: { id: string; label: string; distance: number }[] }
  | { kind: "none" };

export const NEAR_MAX_DISTANCE = 2;
export const NEAR_MIN_PREFIX = 6;

/**
 * Exact key: matched (several ids with the same key is still `exact` with all ids: the caller treats more than one as
 * ambiguous). Edit distance 2 or less, or a shared prefix of 6 or more characters: `near`, never merged on its own.
 */
export function matchName(text: string, entries: readonly NameEntry[], maxOptions = 5): NameMatch {
  const key = nameKey(text);
  if (key === "") return { kind: "none" };
  const exact = entries.filter((e) => e.key === key).map((e) => e.id);
  if (exact.length > 0) return { kind: "exact", ids: [...new Set(exact)] };
  const near: { id: string; label: string; distance: number }[] = [];
  for (const e of entries) {
    const d = editDistance(key, e.key, NEAR_MAX_DISTANCE);
    if (d <= NEAR_MAX_DISTANCE || sharedPrefix(key, e.key) >= NEAR_MIN_PREFIX) {
      near.push({ id: e.id, label: e.label, distance: Math.min(d, 99) });
    }
  }
  if (near.length === 0) return { kind: "none" };
  near.sort((p, q) => p.distance - q.distance || p.label.localeCompare(q.label));
  return { kind: "near", options: near.slice(0, maxOptions) };
}
