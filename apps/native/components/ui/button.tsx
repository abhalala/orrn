import { cn } from "@orrn/ui/lib/utils";
import { motion } from "@orrn/ui/tokens";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, type PressableProps } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

import { useThemeColor } from "@/lib/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
/** `lg` is the 56px floor size for primary actions; `md` (48px) for everything else. */
export type ButtonSize = "lg" | "md";

const containers: Record<ButtonVariant, string> = {
  primary: "bg-primary",
  secondary: "border border-control bg-surface",
  ghost: "bg-transparent",
  danger: "bg-destructive",
};
const labels: Record<ButtonVariant, string> = {
  primary: "text-primary-foreground",
  secondary: "text-ink",
  ghost: "text-ink",
  danger: "text-destructive-foreground",
};

export type ButtonProps = Omit<PressableProps, "children" | "style"> & {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, keeps the label for screen readers and blocks presses. */
  loading?: boolean;
  /** Text shown while `loading` (e.g. "Signing in"); defaults to `label`. */
  loadingLabel?: string;
  icon?: ReactNode;
  className?: string;
};

/**
 * C2 pill button for native. Every press scales to `motion.pressScale` (none
 * under reduced motion); the label is the accessible name; disabled and busy
 * states reach VoiceOver/TalkBack through `accessibilityState`.
 */
export function Button({
  label,
  variant = "primary",
  size = "md",
  loading = false,
  loadingLabel,
  icon,
  disabled,
  className,
  onPressIn,
  onPressOut,
  ...rest
}: ButtonProps) {
  const reduceMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const spinner = useThemeColor(variant === "primary" ? "card" : "foreground");
  const inactive = disabled || loading;
  const shown = loading && loadingLabel ? loadingLabel : label;

  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={shown}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
      onPressIn={(e) => {
        if (!reduceMotion) scale.set(withTiming(motion.pressScale, { duration: motion.durationFast }));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withTiming(1, { duration: motion.durationFast }));
        onPressOut?.(e);
      }}
      style={animated}
      className={cn(
        "flex-row items-center justify-center gap-2 rounded-full px-6",
        size === "lg" ? "min-h-14" : "min-h-12",
        containers[variant],
        inactive && "opacity-60",
        className,
      )}
      {...rest}
    >
      {loading ? <ActivityIndicator size="small" color={spinner} /> : icon}
      <Text
        className={cn("py-3 text-center font-sans-semibold", size === "lg" ? "text-base" : "text-[15px]", labels[variant])}
        maxFontSizeMultiplier={1.6}
      >
        {shown}
      </Text>
    </AnimatedPressable>
  );
}
