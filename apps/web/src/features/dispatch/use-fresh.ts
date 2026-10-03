import { useCallback, useEffect, useRef, useState } from "react";

/** How long a just-added row stays tinted green. */
const FRESH_MS = 1800;

/**
 * Serials added a moment ago, so their rows can pop and tint green briefly
 * (spec §3 Build). Each mark clears itself; unmounting clears everything.
 */
export function useFreshSerials() {
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const mark = useCallback((serials: readonly string[]) => {
    if (serials.length === 0) return;
    setFresh((prev) => new Set([...prev, ...serials]));
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFresh((prev) => {
        const next = new Set(prev);
        for (const s of serials) next.delete(s);
        return next;
      });
    }, FRESH_MS);
    timers.current.add(timer);
  }, []);

  return { fresh, mark };
}
