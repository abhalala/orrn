import { useEffect, useId, type RefObject } from "react";

/**
 * Toasts sit at the bottom of the screen, which is exactly where a flow's
 * sticky action bar lives (Build: Hold stock / Dispatch). A toast over the
 * bar hides the next action, and hovering it to click pauses its timer, so
 * it never leaves. A sticky bar calls `useToastLift(ref)`; the shared
 * `Toaster` reads `--orrn-toast-bottom` and keeps toasts above the bar, and
 * the page's `scroll-padding-bottom` keeps a Tab-focused row above it too.
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

type StyleTarget = Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">;

/**
 * The bar covers the bottom of the viewport, so the same clearance goes to two
 * places: toasts start above it, and the page's scroll padding grows by it so
 * a row reached by Tab scrolls up clear of the bar instead of hiding behind
 * it (WCAG 2.4.11 Focus Not Obscured). `null` (no bar left) clears both.
 */
export function applyBarClearance(style: StyleTarget, px: number | null) {
  if (px === null) {
    style.removeProperty(TOAST_LIFT_VAR);
    style.removeProperty("scroll-padding-bottom");
    return;
  }
  style.setProperty(TOAST_LIFT_VAR, `${px}px`);
  style.setProperty("scroll-padding-bottom", `${px}px`);
}

const shared = createToastLift((px) => {
  if (typeof document === "undefined") return;
  applyBarClearance(document.documentElement.style, px);
});

/**
 * Keeps toasts, and keyboard focus scrolling, clear of this sticky bar while it
 * is mounted (re-measured when it resizes or the viewport changes).
 */
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
