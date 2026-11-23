import { RELAY_REPLAY_WINDOW_MS } from "@orrn/domain";

export interface NonceStore {
  /** Record a nonce. Returns false when it was already seen (replay) or the store is full. */
  claim(nonce: string, now: number): boolean;
}

/**
 * In-memory nonce store. Entries live for the replay window; a nonce older than that is refused by the
 * timestamp check anyway. Bounded: when full of unexpired entries it refuses new nonces instead of evicting.
 */
export function memoryNonceStore(opts: { ttlMs?: number; maxSize?: number } = {}): NonceStore {
  const ttl = opts.ttlMs ?? RELAY_REPLAY_WINDOW_MS * 2; // timestamps may be +-window, so keep 2x
  const max = opts.maxSize ?? 100_000;
  const seen = new Map<string, number>(); // nonce -> expiry (insertion order == expiry order)

  function sweep(now: number) {
    for (const [k, exp] of seen) {
      if (exp > now) break;
      seen.delete(k);
    }
  }

  return {
    claim(nonce, now) {
      sweep(now);
      if (seen.has(nonce)) return false;
      if (seen.size >= max) return false;
      seen.set(nonce, now + ttl);
      return true;
    },
  };
}
