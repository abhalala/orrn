/**
 * One write at a time (final fixes 5, M4b). A double click lands two clicks before React has re-rendered the disabled
 * button, so `isPending` alone cannot stop the second one; this guard flips synchronously. `onceGuard` is the pure core
 * (a bun test runs it); `useOnceMutation` (`once-mutation.ts`) wraps a react-query mutation with it.
 */
export function onceGuard<T>() {
  let inflight: Promise<T> | null = null;
  return {
    /** Runs `start` unless a run is still in flight; then it answers the run in flight and starts nothing. */
    run(start: () => Promise<T>): { promise: Promise<T>; started: boolean } {
      if (inflight) return { promise: inflight, started: false };
      const p = start().finally(() => {
        if (inflight === p) inflight = null;
      });
      inflight = p;
      return { promise: p, started: true };
    },
    get busy() {
      return inflight !== null;
    },
  };
}
