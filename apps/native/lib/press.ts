import { motion } from "@orrn/ui/tokens";

/**
 * The C2 `press` motion as a plain style: scale to `motion.pressScale` while
 * pressed, animated by a Reanimated CSS transition on an Animated component.
 * A plain object (not a `useAnimatedStyle` handle) so NativeWind can merge it
 * with `className` (see __tests__/press.test.ts). Reduced motion keeps scale 1.
 */
export function pressStyle(pressed: boolean, reduceMotion: boolean, scaleTo: number = motion.pressScale) {
  return {
    transform: [{ scale: pressed && !reduceMotion ? scaleTo : 1 }],
    transitionProperty: "transform",
    transitionDuration: motion.durationFast,
  } as const;
}
