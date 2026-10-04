import { useEffect, useId, type RefObject } from "react";

/**
 * Toasts sit at the bottom of the screen, which is exactly where a flow's
 * sticky action bar lives (Build: Hold stock / Dispatch). A toast over the
 * bar hides the next action, and hovering it to click pauses its timer, so
 * it never leaves. A sticky bar calls `useToastLift(ref)`; the shared
 * `Toaster` reads `--orrn-toast-bottom` and keeps toasts above the bar.
 */
export const TOAST_LIFT_VAR = "--orrn-toast-bottom";

/** Space between the top of the bar and the bottom of the lowest toast. */
const GAP = 8;

/** How far above the viewport bottom toasts must start to clear a sticky bar resting at `stickyBottom`. */
export function toastLiftFor({ stickyBottom, height }: { stickyBottom: number; height: number }): number {
  return Math.ceil((Number.isFinite(stickyBottom) ? stickyBottom : 0) + height + GAP);
}

/** Several bars may be mounted at once (a sheet over a flow): the highest one wins. */
export function createToastLift(apply: (px: number | null) => void) {
  const bars = new Map<string, number>();
  const publish = () => apply(bars.size > 0 ? Math.max(...bars.values()) : null);
  return {
    set(id: string, px: number) {
      bars.set(id, px);
      publish();
    },
    remove(id: string) {
      if (bars.delete(id)) publish();
    },
  };
}

const shared = createToastLift((px) => {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  if (px === null) root.removeProperty(TOAST_LIFT_VAR);
  else root.setProperty(TOAST_LIFT_VAR, `${px}px`);
});

/** Keeps toasts above this sticky bar while it is mounted (re-measured when it resizes or the viewport changes). */
export function useToastLift(ref: RefObject<HTMLElement | null>) {
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof window === "undefined") return;
    const measure = () =>
      shared.set(
        id,
        toastLiftFor({ stickyBottom: parseFloat(getComputedStyle(el).bottom), height: el.getBoundingClientRect().height }),
      );
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    // The phone tab bar offset (and so the bar's resting bottom) changes at the 768px breakpoint.
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      shared.remove(id);
    };
  }, [ref, id]);
}
