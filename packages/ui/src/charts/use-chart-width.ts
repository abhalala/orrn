import { useLayoutEffect, useRef, useState } from "react";

/**
 * Width of the element the chart draws into, kept current with a
 * ResizeObserver. 0 until measured: callers reserve the height and draw
 * nothing yet, so there is no layout jump and no wrong-width flash.
 */
export function useChartWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}
