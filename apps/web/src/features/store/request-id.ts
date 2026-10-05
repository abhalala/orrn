import { useRef } from "react";

export type RequestIds = {
  /** The idempotency key for an entry with these values (same values, same key). */
  idFor(signature: string): string;
  /** Forget the key once the entry is saved, so the next entry gets its own. */
  reset(): void;
};

/** Signatures remembered until the next saved entry: far more than anyone edits one form. */
const KEEP = 20;

/**
 * Client keys for store receive/issue/exchange (ruling RP18). A second tap or a retry after a lost
 * response sends the same key, so the server returns the first entry instead of posting twice.
 * Changing the values makes a new key: that is a different entry. Going back to values already
 * sent reuses their key (a refused request stored nothing under it; a lost one is replayed).
 */
export function createRequestIds(generate: () => string = () => crypto.randomUUID()): RequestIds {
  const ids = new Map<string, string>();
  return {
    idFor(signature) {
      let id = ids.get(signature);
      if (!id) {
        id = generate();
        ids.set(signature, id);
        if (ids.size > KEEP) ids.delete(ids.keys().next().value as string);
      }
      return id;
    },
    reset() {
      ids.clear();
    },
  };
}

/** One `RequestIds` for the life of a form. */
export function useRequestIds(): RequestIds {
  const ref = useRef<RequestIds | null>(null);
  if (!ref.current) ref.current = createRequestIds();
  return ref.current;
}
