/**
 * GSAP bootstrap for the marketing surface.
 *
 * ScrollTrigger is registered exactly once at module scope; all section
 * animations run inside a `gsap.context()` scoped to a container ref so
 * unmounting the route reverts every tween/trigger it created. Marketing is
 * the only chunk that imports GSAP — keep it out of the app shell.
 */
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { useEffect, useRef, useState } from "react";

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

/** Shared easing names matching the motion tokens in @orrn/ui/tokens. */
export const EASE = {
  outExpo: "expo.out",
  outQuart: "power4.out",
  inOut: "power2.inOut",
} as const;

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

/**
 * Run a GSAP setup function inside a context scoped to `scopeRef`. The setup
 * receives a `gsap.matchMedia()` instance so callers can split desktop
 * (pinning/scrub) vs mobile (lighter enter animations) behaviors. Everything
 * reverts on unmount. Skipped entirely when reduced motion is preferred —
 * content must be fully visible without animation.
 */
export function useMarketingGsap(
  scopeRef: React.RefObject<HTMLElement | null>,
  setup: (mm: gsap.MatchMedia, ctx: gsap.Context) => void,
) {
  const reduced = usePrefersReducedMotion();
  const setupRef = useRef(setup);
  setupRef.current = setup;

  useEffect(() => {
    if (reduced || !scopeRef.current) return;
    // gsap.context() invokes its callback synchronously, so use the `self`
    // argument rather than the (not-yet-assigned) `ctx` binding.
    const ctx = gsap.context((self) => {
      const mm = gsap.matchMedia(scopeRef.current ?? undefined);
      setupRef.current(mm, self as gsap.Context);
    }, scopeRef);
    return () => ctx.revert();
  }, [reduced, scopeRef]);

  return reduced;
}

/** Breakpoints shared by all marketing matchMedia splits. */
export const MQ = {
  desktop: "(min-width: 768px)",
  mobile: "(max-width: 767px)",
} as const;
