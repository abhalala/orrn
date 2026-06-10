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
 * Full brand-blue ramp. Used for gradients, glass tints, glow effects, and
 * hover states where the three flat brand values aren't enough. 500 ≡
 * `brand.primary`.
 */
export const brandRamp = {
  50: "#eef3ff",
  100: "#dfe9ff",
  200: "#c5d6ff",
  300: "#a2bcff",
  400: "#7c9cff",
  500: "#4f7cff",
  600: "#2f5fe8",
  700: "#244cc4",
  800: "#1f3e9c",
  900: "#1e377c",
  950: "#16234a",
} as const;

/**
 * Godseye (platform admin console) accent identity. A violet layer applied on
 * top of the shared theme via the `.godseye` CSS class so staff always know
 * which surface they're on. Same components, different accent.
 */
export const godseye = {
  primary: "#8b5cf6",
  primarySoft: "#f1ebff",
  primaryStrong: "#7c3aed",
  primaryFg: "#ffffff",
  /** Dark-mode tinted surfaces for the Godseye shell. */
  darkBg: "#0a0814",
  darkBgElevated: "#15101f",
} as const;

/**
 * Motion tokens. Mirrored as CSS vars (`--dur-*`, `--ease-*`) in
 * `globals.css`; reference these for any JS-driven animation (GSAP, RN) so
 * web + native stay in step.
 */
export const motion = {
  durationFast: 150,
  durationBase: 250,
  durationSlow: 400,
  durationSlower: 700,
  easeOutExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
  easeOutQuart: "cubic-bezier(0.25, 1, 0.5, 1)",
  easeInOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  easeSpring: "cubic-bezier(0.32, 0.72, 0, 1)",
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
    /** Recessed wells: input backgrounds, code blocks, inset panels. */
    bgSunken: "#eef2f7",
    /** Scrims/overlay surfaces above elevated content (sheets, popovers). */
    bgOverlay: "#ffffff",
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
    bgSunken: "#04060c",
    bgOverlay: "#141d2b",
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

/**
 * Marketing display sizes. Clamp-based so the hero scales fluidly from
 * mobile to desktop without breakpoint jumps. Web-only (CSS strings).
 */
export const displaySizes = {
  /** Hero headline: 40px → 96px. */
  display1: "clamp(2.5rem, 1.2rem + 5.5vw, 6rem)",
  /** Section headline: 30px → 56px. */
  display2: "clamp(1.875rem, 1.1rem + 3vw, 3.5rem)",
  /** Sub-section headline: 24px → 36px. */
  display3: "clamp(1.5rem, 1.2rem + 1.4vw, 2.25rem)",
} as const;

/** Shadows. Web-only; native uses elevation. */
export const shadows = {
  none: "none",
  sm: "0 1px 2px rgba(15, 23, 42, 0.06)",
  md: "0 4px 12px rgba(15, 23, 42, 0.08)",
  lg: "0 12px 32px rgba(15, 23, 42, 0.12)",
} as const;
