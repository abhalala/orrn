import { motion } from "@orrn/ui/tokens";

/**
 * C2 `pop` and `rise` as plain descriptions. `lib/entering.ts` turns one into
 * a Reanimated `entering` animation; keeping the decision here (and free of
 * React Native) means reduced motion is one tested rule: under it there is no
 * entering animation at all (`undefined`), never a shortened one.
 */
export type EnterSpec = { kind: "pop" | "rise"; delay: number; duration: number };

/** Success moment: scan OK, bundle saved, dispatch done. */
export function popEntering(reduceMotion: boolean): EnterSpec | undefined {
  if (reduceMotion) return undefined;
  return { kind: "pop", delay: 0, duration: motion.durationSlow };
}

/** First-load stagger of a screen's blocks: 14px slide-up and fade, `riseStagger` apart (capped at 8 steps). */
export function riseEntering(reduceMotion: boolean, index: number): EnterSpec | undefined {
  if (reduceMotion) return undefined;
  return { kind: "rise", delay: Math.min(Math.max(index, 0), 8) * motion.riseStagger, duration: motion.durationSlow };
}
