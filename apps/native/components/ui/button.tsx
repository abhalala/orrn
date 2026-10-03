import { cn } from "@orrn/ui/lib/utils";
import type { ReactNode } from "react";
import { ActivityIndicator, Text, type PressableProps } from "react-native";

import { PressableScale } from "@/components/ui/pressable-scale";
import { useThemeColor } from "@/lib/theme";

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
 * under reduced motion, see PressableScale); the label is the accessible name; disabled and busy
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
  ...rest
}: ButtonProps) {
  const spinner = useThemeColor(variant === "primary" ? "card" : "foreground");
  const inactive = disabled || loading;
  const shown = loading && loadingLabel ? loadingLabel : label;

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={shown}
      accessibilityState={{ disabled: !!inactive, busy: loading }}
      disabled={inactive}
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
    </PressableScale>
  );
}
