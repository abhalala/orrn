import { useRef } from "react";

export type RequestIds = {
  /** The idempotency key for an entry with these values (same values, same key). */
  idFor(signature: string): string;
  /** Forget the key once the entry is saved, so the next entry gets its own. */
  reset(): void;
};

/**
 * Client keys for store receive/issue/exchange (ruling RP18). A second tap or a retry after a lost
 * response sends the same key, so the server returns the first entry instead of posting twice.
 * Changing the values makes a new key: that is a different entry.
 */
export function createRequestIds(generate: () => string = () => crypto.randomUUID()): RequestIds {
  let current: { signature: string; id: string } | null = null;
  return {
    idFor(signature) {
      if (!current || current.signature !== signature) current = { signature, id: generate() };
      return current.id;
    },
    reset() {
      current = null;
    },
  };
}

/** One `RequestIds` for the life of a form. */
export function useRequestIds(): RequestIds {
  const ref = useRef<RequestIds | null>(null);
  if (!ref.current) ref.current = createRequestIds();
  return ref.current;
}
