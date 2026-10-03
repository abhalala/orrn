import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";
import {
  bundleStatusTones,
  dispatchStatusTones,
  roleTones,
  type StatusTone,
  type ToneName,
} from "../tokens";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "brand";

/** C2 chip classes: theme-aware tint + ink pairs (>= 4.5:1, see tokens.test.ts). */
const PALETTE_CLASSES: Record<ToneName, string> = {
  neutral: "bg-tone-neutral-tint text-tone-neutral-ink",
  blue: "bg-tone-blue-tint text-tone-blue-ink",
  green: "bg-tone-green-tint text-tone-green-ink",
  amber: "bg-tone-amber-tint text-tone-amber-ink",
  red: "bg-tone-red-tint text-tone-red-ink",
  violet: "bg-tone-violet-tint text-tone-violet-ink",
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: PALETTE_CLASSES.neutral,
  info: PALETTE_CLASSES.blue,
  success: PALETTE_CLASSES.green,
  warning: PALETTE_CLASSES.amber,
  danger: PALETTE_CLASSES.red,
  brand: "bg-primary text-primary-foreground",
};

const SIZE_CLASSES = {
  sm: "min-h-[22px] px-2.5 py-0.5 text-[11px]",
  md: "min-h-7 px-3 py-1 text-xs",
} as const;

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
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
  className,
  style,
  children,
  ...rest
}: BadgeProps) {
  const overrides = background || foreground ? { backgroundColor: background, color: foreground } : undefined;
  return (
    <span
      data-slot="badge"
      className={cn(
        "inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-full font-semibold leading-none tracking-[0.005em]",
        SIZE_CLASSES[size],
        !overrides && TONE_CLASSES[tone],
        className,
      )}
      style={overrides ? { ...overrides, ...style } : style}
      {...rest}
    >
      {children}
    </span>
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
 * Specialised badge for our dispatch / bundle / role status palettes. The
 * status word is always rendered (colour is never the only signal). Tone
 * mapping lives in `@orrn/ui/tokens` so web and native stay consistent.
 */
export function StatusBadge({ kind, value, label, className, ...rest }: StatusBadgeProps) {
  const tone = statusToneFor(kind, value);
  if (!tone) {
    return (
      <Badge tone="neutral" className={className} {...rest}>
        {label ?? value}
      </Badge>
    );
  }
  // Web renders the theme-aware C2 chip for the status tone; the raw
  // `bg`/`fg` hex pair is the light-mode equivalent kept for native.
  return (
    <Badge {...rest} className={cn(PALETTE_CLASSES[tone.palette], className)}>
      {label ?? value.charAt(0).toUpperCase() + value.slice(1)}
    </Badge>
  );
}
