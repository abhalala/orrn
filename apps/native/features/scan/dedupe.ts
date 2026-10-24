/** How long one label stays "just read" (spec: 1.5 s per value). Same as web features/scan/dedupe.ts. */
export const DEDUPE_WINDOW_MS = 1500;

/**
 * Drops repeat reads of the same value from a camera that sees the label on
 * every frame. A value is accepted once, then ignored until it has been out
 * of sight for `windowMs`: every sighting restarts its window, so a label held
 * in front of the camera is read once. Other values pass straight through.
 */
export function createDeduper(windowMs = DEDUPE_WINDOW_MS, now: () => number = () => Date.now()) {
  const lastSeen = new Map<string, number>();
  return {
    accept(value: string): boolean {
      const at = now();
      for (const [key, seen] of lastSeen) if (at - seen >= windowMs) lastSeen.delete(key);
      const fresh = !lastSeen.has(value);
      lastSeen.set(value, at);
      return fresh;
    },
    reset() {
      lastSeen.clear();
    },
  };
}
