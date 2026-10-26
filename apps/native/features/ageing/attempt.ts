import { replayKey, type ReplayAttempt } from "@/lib/replay-key";

/**
 * The replay key of one keyed ageing write, as a small pure holder (no React) so bun tests run it.
 * - `key(body)`: the key for this content. The same content again (a second tap after an unsure answer) is the
 *   SAME key; edited content gets a new one, and going back to the first content gets the first key again.
 * - `saved()`: the server answered for good, so the next write is a new one with its own key.
 * - `forget()`: the person started something new (a sheet opened). A reading typed again with the same value is a
 *   new reading, never the replay of an earlier one.
 */
export function createAttempt(fresh: () => string) {
  let current: ReplayAttempt = null;
  return {
    key(body: unknown): string {
      const next = replayKey(current, body, fresh);
      current = next.attempt;
      return next.id;
    },
    saved(): void {
      current = null;
    },
    forget(): void {
      current = null;
    },
  };
}

export type Attempt = ReturnType<typeof createAttempt>;
