import { forwardRef, useState } from "react";
import type { PressableProps, View } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

import { AnimatedPressable } from "@/lib/nativewind-interop";
import { pressStyle } from "@/lib/press";

export type PressableScaleProps = Omit<PressableProps, "style"> & {
  className?: string;
  /** Scale while pressed; defaults to the C2 `motion.pressScale` (0.97). */
  scaleTo?: number;
};

/**
 * Every C2 pressable: a Pressable that takes `className` and shrinks a little
 * while pressed (the `press` motion), with no scale under reduced motion. The
 * scale is a Reanimated CSS transition on a plain style (`pressStyle`), never a
 * `useAnimatedStyle` handle, so it survives NativeWind's style merge. Build
 * buttons, tiles, rows and tabs on this instead of a bare Pressable.
 */
export const PressableScale = forwardRef<View, PressableScaleProps>(function PressableScale(
  { scaleTo, onPressIn, onPressOut, className, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();
  const [pressed, setPressed] = useState(false);

  return (
    <AnimatedPressable
      ref={ref}
      {...rest}
      className={className}
      style={pressStyle(pressed, reduceMotion, scaleTo)}
      onPressIn={(e) => {
        setPressed(true);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        setPressed(false);
        onPressOut?.(e);
      }}
    />
  );
});
