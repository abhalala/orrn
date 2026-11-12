import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { refreshIngest } from "./actions";
import { isConflict } from "./pump";

/**
 * One write at a time on a screen. While a write runs, a second press does nothing: an early return, so the button
 * stays focusable (use `aria-disabled={busy}`, not `disabled`, which would drop focus). A stale `serverSeq` (CONFLICT)
 * refreshes the candidate so the page shows the latest, and the error stays for `ActionError`.
 *
 * `run` gives true when the write went through.
 */
export function useRunAction(): {
  /** The name of the write in flight, or null. */
  pending: string | null;
  busy: boolean;
  error: unknown;
  run: (name: string, fn: () => Promise<unknown>, opts?: { candidateId?: string }) => Promise<boolean>;
  clearError: () => void;
} {
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);
  const flight = useRef<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const run = useCallback(
    async (name: string, fn: () => Promise<unknown>, opts?: { candidateId?: string }) => {
      if (flight.current !== null) return false;
      flight.current = name;
      setPending(name);
      setError(null);
      try {
        await fn();
        return true;
      } catch (e) {
        setError(e);
        if (isConflict(e)) await refreshIngest(qc, opts?.candidateId);
        return false;
      } finally {
        flight.current = null;
        setPending(null);
      }
    },
    [qc],
  );
  return { pending, busy: pending !== null, error, run, clearError: useCallback(() => setError(null), []) };
}
