/**
 * GSAP for the marketing page, and only there (GSAP stays out of the app
 * chunks). Core only: scroll moments use IntersectionObserver, not
 * ScrollTrigger, which keeps `/` inside its JS budget
 * (scripts/check-route-budget.ts).
 *
 * Every animation is a `from` tween towards the layout the markup already
 * has, so the page is complete without GSAP. Under `prefers-reduced-motion`
 * nothing runs at all: the static final state is the page. Setup runs in a
 * layout effect (before paint, so there is no flash of the final state before
 * the tween) inside a `gsap.context`, and everything reverts on unmount or
 * when reduced motion is switched on.
 */
import gsap from "gsap";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export { gsap };

/** C2 motion tokens as GSAP eases. */
export const EASE = {
  /** `rise`: 14px slide-up with a little overshoot. */
  rise: "back.out(1.4)",
  /** `pop`: 0.6 to 1.08 to 1, for a success moment. */
  pop: "back.out(2.2)",
  out: "expo.out",
} as const;

/** Phone layouts stack the sections; tablets and up lay them out side by side. */
export const MQ = {
  wide: "(min-width: 768px)",
  narrow: "(max-width: 767px)",
} as const;

const REDUCED = "(prefers-reduced-motion: reduce)";

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia(REDUCED).matches);
  useEffect(() => {
    const mq = window.matchMedia(REDUCED);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export type MarketingGsapSetup = (args: { scope: HTMLElement; mm: gsap.MatchMedia }) => void | (() => void);

/**
 * Runs `setup` for the element in `scopeRef` unless reduced motion is on.
 * `mm` is a `gsap.matchMedia()` scoped to it, for phone vs wide splits.
 * Returns whether reduced motion is on.
 */
export function useMarketingGsap(scopeRef: RefObject<HTMLElement | null>, setup: MarketingGsapSetup): boolean {
  const reduced = usePrefersReducedMotion();
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useLayoutEffect(() => {
    const scope = scopeRef.current;
    if (reduced || !scope) return;
    let cleanup: void | (() => void);
    let mm: gsap.MatchMedia | undefined;
    const ctx = gsap.context(() => {
      mm = gsap.matchMedia(scope);
      cleanup = setupRef.current({ scope, mm });
    }, scope);
    return () => {
      cleanup?.();
      mm?.revert();
      ctx.revert();
    };
  }, [reduced, scopeRef]);

  return reduced;
}

/**
 * Calls `onEnter` once, the first time `el` reaches the lower-middle of the
 * viewport. Returns a cleanup. Without IntersectionObserver it fires at once.
 */
export function onceInView(el: Element, onEnter: () => void, rootMargin = "0px 0px -30% 0px"): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onEnter();
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      onEnter();
    },
    { rootMargin },
  );
  io.observe(el);
  return () => io.disconnect();
}
