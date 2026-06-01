/**
 * ORRN brand + status tokens. Single source of truth for colors across web
 * (Tailwind / shadcn) and native (NativeWind + RN StyleSheet).
 *
 * Keep raw hex values here. Tailwind @theme blocks in
 * `packages/ui/src/styles/globals.css` (web) and `apps/native/global.css`
 * (native) pull from this file so colors only ever live in one place.
 */

export const brand = {
  /** Primary action color — clear blue without the neon SaaS cast. */
  primary: "#4f7cff",
  primarySoft: "#eaf0ff",
  primaryStrong: "#2f5fe8",
  primaryFg: "#ffffff",

  /** Accent for secondary nav highlights, badges, etc. */
  accent: "#2dd4bf",
  accentFg: "#062923",
} as const;

/**
 * Neutral surface ramps, light + dark.
 *
 * The numbers loosely map to Tailwind's slate scale so screens migrating off
 * Tailwind utility classes (e.g. `bg-slate-50`) still look right under the new
 * tokens.
 */
export const neutrals = {
  light: {
    bg: "#f6f8fb",
    bgElevated: "#ffffff",
    bgMuted: "#edf2f7",
    border: "#d9e1ea",
    borderStrong: "#cbd5e1",
    fg: "#111827",
    fgMuted: "#5d6b7c",
    fgSubtle: "#8b98a9",
  },
  dark: {
    bg: "#070a11",
    bgElevated: "#101722",
    bgMuted: "#182231",
    border: "#263142",
    borderStrong: "#3a475a",
    fg: "#f4f7fb",
    fgMuted: "#a7b2c2",
    fgSubtle: "#737f91",
  },
} as const;

export const semantic = {
  success: "#10b981",
  successSoft: "#d1fae5",
  successFg: "#064e3b",
  warning: "#f59e0b",
  warningSoft: "#fef3c7",
  warningFg: "#78350f",
  danger: "#ef4444",
  dangerSoft: "#fee2e2",
  dangerFg: "#7f1d1d",
  info: "#3b82f6",
  infoSoft: "#dbeafe",
  infoFg: "#1e3a8a",
} as const;

/**
 * Per-status display tokens for dispatch and bundle. Returned as bg + fg
 * pairs so components don't need to compute contrast.
 */
export type StatusTone = {
  bg: string;
  fg: string;
  /** Slightly darker bg for hover/pressed states. */
  bgStrong: string;
  /** Tone label, useful for analytics / a11y. */
  tone: "neutral" | "info" | "warning" | "success" | "danger";
};

export const dispatchStatusTones: Record<
  "draft" | "reserved" | "completed" | "cancelled",
  StatusTone
> = {
  draft: { bg: "#e2e8f0", bgStrong: "#cbd5e1", fg: "#1f2937", tone: "neutral" },
  reserved: { bg: semantic.warningSoft, bgStrong: "#fde68a", fg: semantic.warningFg, tone: "warning" },
  completed: { bg: semantic.successSoft, bgStrong: "#a7f3d0", fg: semantic.successFg, tone: "success" },
  cancelled: { bg: semantic.dangerSoft, bgStrong: "#fecaca", fg: semantic.dangerFg, tone: "danger" },
} as const;

export const bundleStatusTones: Record<
  "available" | "reserved" | "dispatched" | "void",
  StatusTone
> = {
  available: { bg: semantic.successSoft, bgStrong: "#a7f3d0", fg: semantic.successFg, tone: "success" },
  reserved: { bg: semantic.warningSoft, bgStrong: "#fde68a", fg: semantic.warningFg, tone: "warning" },
  dispatched: { bg: semantic.infoSoft, bgStrong: "#bfdbfe", fg: semantic.infoFg, tone: "info" },
  void: { bg: "#e2e8f0", bgStrong: "#cbd5e1", fg: "#475569", tone: "neutral" },
} as const;

/** Roles get muted neutral tones except platform-admin which gets brand accent. */
export const roleTones: Record<
  "owner" | "admin" | "manager" | "operator" | "viewer" | "platform",
  StatusTone
> = {
  owner: { bg: "#e0e7ff", bgStrong: "#c7d2fe", fg: "#312e81", tone: "info" },
  admin: { bg: "#ede9fe", bgStrong: "#ddd6fe", fg: "#5b21b6", tone: "info" },
  manager: { bg: "#dbeafe", bgStrong: "#bfdbfe", fg: "#1e3a8a", tone: "info" },
  operator: { bg: "#dcfce7", bgStrong: "#bbf7d0", fg: "#14532d", tone: "success" },
  viewer: { bg: "#f1f5f9", bgStrong: "#e2e8f0", fg: "#475569", tone: "neutral" },
  platform: { bg: "#fef3c7", bgStrong: "#fde68a", fg: "#78350f", tone: "warning" },
} as const;

/**
 * Spacing scale (px). Mirrors Tamagui defaults loosely so we can reference
 * the same numbers in raw inline styles when we need to.
 */
export const space = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 32,
  8: 40,
  9: 48,
  10: 56,
  12: 72,
  16: 96,
} as const;

/** Border radius scale (px). */
export const radii = {
  none: 0,
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  "2xl": 16,
  full: 9999,
} as const;

/** Typography scale (px). */
export const fontSizes = {
  xs: 11,
  sm: 12,
  md: 14,
  lg: 16,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
} as const;

/** Shadows. Web-only; native uses elevation. */
export const shadows = {
  none: "none",
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 4px 12px rgba(15, 23, 42, 0.08)",
  lg: "0 12px 32px rgba(15, 23, 42, 0.12)",
} as const;
