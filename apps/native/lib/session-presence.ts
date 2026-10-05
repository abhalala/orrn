import { hasStoredSession } from "./auth-client";

/**
 * Whether this device holds a session cookie, as a tiny external store for
 * `useSyncExternalStore`. Reading SecureStore on every render would be
 * wasteful, so the value is cached and refreshed by `changed()` after sign-in
 * and sign-out.
 */
type Listener = () => void;
const listeners = new Set<Listener>();
let present: boolean | undefined;

export const sessionPresence = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  get(): boolean {
    if (present === undefined) present = hasStoredSession();
    return present;
  },
  changed(): void {
    present = hasStoredSession();
    for (const listener of listeners) listener();
  },
};
