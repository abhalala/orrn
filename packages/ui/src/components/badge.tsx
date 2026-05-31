import type { ReactNode } from "react";

import {
  bundleStatusTones,
  dispatchStatusTones,
  roleTones,
  type StatusTone,
} from "../tokens";
import { Stack, Text } from "@orrn/ui/lib/tg";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

const TONE_STYLES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: "#e2e8f0", fg: "#1f2937" },
  info: { bg: "#dbeafe", fg: "#1e3a8a" },
  success: { bg: "#d1fae5", fg: "#064e3b" },
  warning: { bg: "#fef3c7", fg: "#78350f" },
  danger: { bg: "#fee2e2", fg: "#7f1d1d" },
  brand: { bg: "#eef0ff", fg: "#3b4edd" },
};

export type BadgeProps = Record<string, any> & {
  tone?: BadgeTone;
  size?: "sm" | "md";
  background?: string;
  foreground?: string;
  children?: ReactNode;
};

export function Badge({
  tone = "neutral",
  size = "sm",
  background,
  foreground,
  children,
  ...rest
}: BadgeProps) {
  const palette = TONE_STYLES[tone];
  const bg = background ?? palette.bg;
  const fg = foreground ?? palette.fg;
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      backgroundColor={bg}
      paddingHorizontal={size === "sm" ? 8 : 10}
      paddingVertical={size === "sm" ? 2 : 4}
      borderRadius={999}
      flexDirection="row"
      {...rest}
    >
      <Text fontSize={size === "sm" ? 10 : 12} fontWeight="600" color={fg}>
        {children}
      </Text>
    </Stack>
  );
}

export type DispatchStatus = keyof typeof dispatchStatusTones;
export type BundleStatus = keyof typeof bundleStatusTones;
export type RoleKey = keyof typeof roleTones;

function statusToneFor(kind: "dispatch" | "bundle" | "role", value: string): StatusTone | null {
  switch (kind) {
    case "dispatch":
      return (dispatchStatusTones as Record<string, StatusTone>)[value] ?? null;
    case "bundle":
      return (bundleStatusTones as Record<string, StatusTone>)[value] ?? null;
    case "role":
      return (roleTones as Record<string, StatusTone>)[value] ?? null;
    default:
      return null;
  }
}

export type StatusBadgeProps = Omit<BadgeProps, "tone" | "background" | "foreground" | "children"> & {
  kind: "dispatch" | "bundle" | "role";
  value: string;
  label?: string;
};

/**
 * Specialised badge for our dispatch / bundle / role status palettes.
 */
export function StatusBadge({ kind, value, label, ...rest }: StatusBadgeProps) {
  const tone = statusToneFor(kind, value);
  if (!tone) {
    return (
      <Badge tone="neutral" {...rest}>
        {label ?? value}
      </Badge>
    );
  }
  return (
    <Badge background={tone.bg} foreground={tone.fg} {...rest}>
      {label ?? value.charAt(0).toUpperCase() + value.slice(1)}
    </Badge>
  );
}
