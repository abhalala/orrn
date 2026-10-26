import { useEffect, useRef, useState } from "react";

type TimerApi = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };

const REAL_TIMERS: TimerApi = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export type Debouncer<T> = {
  /** Offer the current value. The same value again changes nothing (no timer is restarted). */
  push: (value: T) => void;
  /** True while a changed value waits for its delay. */
  pending: () => boolean;
  dispose: () => void;
};

/**
 * The settling rule behind `useDebounced`, with no React in it so it can be tested with a fake clock.
 * `onSettle` fires once, `ms` after the last CHANGED value, and never for a value equal (`Object.is`) to
 * the one already settled or already waiting. Pass primitives (or a string key): a fresh object is a
 * changed value every time, which is how a screen can end up re-rendering forever.
 */
export function createDebouncer<T>(initial: T, ms: number, onSettle: (value: T) => void, timers: TimerApi = REAL_TIMERS): Debouncer<T> {
  let settled = initial;
  let offered = initial;
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) timers.clear(handle);
    handle = null;
  };
  return {
    push(value) {
      if (Object.is(value, offered)) return;
      offered = value;
      cancel();
      if (Object.is(value, settled)) return;
      handle = timers.set(() => {
        handle = null;
        settled = offered;
        onSettle(settled);
      }, ms);
    },
    pending: () => handle !== null,
    dispose: cancel,
  };
}

/**
 * `value` after it has stopped changing for `ms` (search boxes, the pack line preview). `value` must be a
 * primitive or otherwise stable: an object built during render is "new" on every render and would never settle.
 */
export function useDebounced<T>(value: T, ms = 250): T {
  const [settled, setSettled] = useState(value);
  const settledRef = useRef(settled);
  const debouncer = useRef<Debouncer<T> | null>(null);
  useEffect(() => {
    const d = createDebouncer(settledRef.current, ms, (next) => {
      settledRef.current = next;
      setSettled(next);
    });
    debouncer.current = d;
    return () => {
      d.dispose();
      debouncer.current = null;
    };
  }, [ms]);
  useEffect(() => {
    debouncer.current?.push(value);
  }, [value, ms]);
  return settled;
}
