import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";

import { motion } from "../tokens";

/**
 * C2 motion vocabulary for web. The keyframes live in `styles/globals.css`;
 * these are the class names to put on elements:
 *
 * - `pop`: success moment (scan OK, bundle saved, dispatch done)
 * - `rise`: first-load stagger of a screen's blocks; pair with `riseDelay(i)`
 * - `shimmer`: one-shot sheen across a success block (element must be positioned)
 * - `press`: scale 0.97 while pressed, for every custom pressable
 *
 * All of them switch off under `prefers-reduced-motion`.
 */
export const motionClass = {
  pop: "animate-pop",
  rise: "animate-rise",
  shimmer: "animate-shimmer",
  press: "animate-press",
} as const;

export type MotionName = keyof typeof motionClass;

/** Inline style that staggers the `rise` of the i-th item (70ms apart, capped). */
export function riseDelay(index: number): CSSProperties {
  const step = motion.riseStagger;
  return { animationDelay: `${Math.min(index, 8) * step}ms` };
}

const REDUCED_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function readReduced() {
  return typeof window !== "undefined" && !!window.matchMedia?.(REDUCED_QUERY).matches;
}

/** True when the person asked the OS for less motion. Updates live. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, readReduced, () => false);
}

function easeOutExpo(t: number) {
  return t >= 1 ? 1 : 1 - 2 ** (-10 * t);
}

export type CountUpOptions = {
  /** Milliseconds for the count. Default 700 (tokens `durationSlower`). */
  duration?: number;
  /** Set false to show the value straight away. Default true. */
  enabled?: boolean;
};

/**
 * Counts from 0 (first render) or the previous value up to `target` with an
 * ease-out curve. Returns `target` immediately under reduced motion, when
 * disabled, or for non-finite input.
 */
export function useCountUp(target: number, options: CountUpOptions = {}): number {
  const { duration = motion.durationSlower, enabled = true } = options;
  const reduced = usePrefersReducedMotion();
  const animate = enabled && !reduced && Number.isFinite(target);
  const [display, setDisplay] = useState(() => (animate ? 0 : target));
  const fromRef = useRef(animate ? 0 : target);

  useEffect(() => {
    if (!animate) {
      fromRef.current = target;
      setDisplay(target);
      return;
    }
    const from = fromRef.current;
    if (from === target) {
      setDisplay(target);
      return;
    }
    let frame = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const t = Math.min(1, (now - start) / duration);
      const value = from + (target - from) * easeOutExpo(t);
      fromRef.current = value;
      setDisplay(value);
      if (t < 1) frame = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [animate, duration, target]);

  return animate ? display : target;
}
