import { useCallback, useSyncExternalStore } from "react";

/**
 * Live `matchMedia` result. Used where the DOM itself must change with the
 * breakpoint (a `<table>` on laptops, a stacked list on phones), not just the
 * styling; for styling prefer Tailwind breakpoints.
 */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : serverFallback),
    [query, serverFallback],
  );
  return useSyncExternalStore(subscribe, read, () => serverFallback);
}

/** Breakpoints from the spec: phone < 768, iPad 768-1279 (sidebar >= 1024), laptop >= 1280. */
export const breakpoints = {
  tablet: "(min-width: 768px)",
  desktop: "(min-width: 1024px)",
  laptop: "(min-width: 1280px)",
} as const;
