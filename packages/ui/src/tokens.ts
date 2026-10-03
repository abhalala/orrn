/**
 * ORRN design tokens, C2 "colour-block pop". Single source of truth for
 * colours across web (Tailwind / shadcn) and native (NativeWind + RN).
 *
 * Keep raw hex values here. The Tailwind bridge in
 * `packages/ui/src/styles/globals.css` (web) mirrors these values as CSS
 * variables; `tokens.test.ts` checks every text/background pairing against
 * WCAG 2.2 AA so a value can't drift below 4.5:1 unnoticed.
 *
 * The idea: a light warm-neutral canvas, ink type, and status IS the colour.
 * Saturated gradient blocks carry status; everything else stays quiet.
 */

/* -------------------------------------------------------------------------- */
/* C2 core palette                                                            */
/* -------------------------------------------------------------------------- */

export type SurfacePalette = {
  /** Page background. */
  canvas: string;
  /** Cards, sheets, dialogs, inputs. */
  surface: string;
  /** Recessed wells, hover fills, segmented-control tracks. */
  surfaceSunken: string;
  /** Primary text and the primary (ink) button. */
  ink: string;
  /** Secondary text. Must stay >= 4.5:1 on canvas, surface and sunken. */
  inkMuted: string;
  /** Decorative dividers and card edges. */
  hairline: string;
  /** Form-control boundaries (inputs, checkboxes). >= 3:1 on canvas and surface. */
  control: string;
};

export const c2: { light: SurfacePalette; dark: SurfacePalette } = {
  light: {
    canvas: "#f4f4f1",
    surface: "#ffffff",
    surfaceSunken: "#efefeb",
    ink: "#0c0c0e",
    inkMuted: "#66666b",
    hairline: "#e7e7e2",
    control: "#85858b",
  },
  dark: {
    canvas: "#0c0c0e",
    surface: "#17171a",
    surfaceSunken: "#1f1f23",
    ink: "#f4f4f1",
    inkMuted: "#9a9aa0",
    hairline: "#26262a",
    control: "#6b6b72",
  },
};

/** The sidebar and other "ink panels" use this palette in both themes. */
export const inkPanel = {
  bg: "#0c0c0e",
  bgRaised: "#1c1c20",
  fg: "#f4f4f1",
  fgMuted: "#a1a1a8",
  border: "#26262a",
  /** Active nav item: a light pill with ink text. */
  activeBg: "#ffffff",
  activeFg: "#0c0c0e",
} as const;

/* -------------------------------------------------------------------------- */
/* Tones: status colour blocks + chips                                        */
/* -------------------------------------------------------------------------- */

export type ToneName = "green" | "blue" | "amber" | "red" | "violet" | "neutral";

export type Tone = {
  /** Lighter gradient stop (top-left). On-block text is measured against it. */
  from: string;
  /** Darker gradient stop. */
  to: string;
  /** Text and icons on top of the gradient block. */
  on: string;
  /** Chip colours (soft tint + ink) per theme. */
  light: { tint: string; ink: string };
  dark: { tint: string; ink: string };
};

/**
 * Status tones. Meaning:
 * - green: in stock, ready, completed
 * - blue: reserved, held, in progress
 * - amber: draft, ageing, needs attention (dark ink on top)
 * - red: void, cancelled, error, destructive
 * - violet: Godseye (platform console) only
 * - neutral: dispatched, archived, navigation blocks that aren't a status
 *
 * Gradient stops are darker than the C2 mockup's first draft so white text
 * clears 4.5:1 against the lighter stop (ruling R10).
 */
export const tones: Record<ToneName, Tone> = {
  green: {
    from: "#13873f",
    to: "#0b6b30",
    on: "#ffffff",
    light: { tint: "#dcf5e3", ink: "#0d5c2b" },
    dark: { tint: "#0f2a1a", ink: "#7ee2a2" },
  },
  blue: {
    from: "#2563eb",
    to: "#1d4ed8",
    on: "#ffffff",
    light: { tint: "#e0eaff", ink: "#1a43b8" },
    dark: { tint: "#132042", ink: "#9cbcff" },
  },
  amber: {
    from: "#ffc21a",
    to: "#ff9500",
    on: "#1a1200",
    light: { tint: "#fff0cc", ink: "#7a4300" },
    dark: { tint: "#2e2206", ink: "#ffd166" },
  },
  red: {
    from: "#dc2626",
    to: "#b91c1c",
    on: "#ffffff",
    light: { tint: "#fde3e1", ink: "#a01818" },
    dark: { tint: "#33120f", ink: "#ffa49a" },
  },
  violet: {
    from: "#7c3aed",
    to: "#6d28d9",
    on: "#ffffff",
    light: { tint: "#ede6ff", ink: "#5b21b6" },
    dark: { tint: "#231637", ink: "#c9b5ff" },
  },
  neutral: {
    from: "#2a2a2e",
    to: "#0c0c0e",
    on: "#ffffff",
    light: { tint: "#ecece7", ink: "#3a3a3e" },
    dark: { tint: "#26262a", ink: "#d4d4d8" },
  },
};

/** Text colour for errors and destructive links (not the button fill). */
export const dangerText = { light: "#b91c1c", dark: "#f87171" } as const;

/* -------------------------------------------------------------------------- */
/* Legacy-shaped exports (kept so existing imports don't break)               */
/* -------------------------------------------------------------------------- */

/** Primary action = ink. Accent = the green "ready" tone. */
export const brand = {
  primary: c2.light.ink,
  primarySoft: c2.light.surfaceSunken,
  primaryStrong: "#000000",
  primaryFg: "#ffffff",
  accent: tones.green.from,
  accentFg: tones.green.on,
} as const;

/**
 * @deprecated The blue brand ramp belonged to the pre-C2 glow aesthetic. It
 * now maps to a neutral ink ramp so any leftover reference renders quietly.
 */
export const brandRamp = {
  50: "#f7f7f5",
  100: "#f4f4f1",
  200: "#e7e7e2",
  300: "#d4d4cf",
  400: "#a1a1a8",
  500: "#66666b",
  600: "#3a3a3e",
  700: "#2a2a2e",
  800: "#1c1c20",
  900: "#121214",
  950: "#0c0c0e",
} as const;

/**
 * Godseye (platform admin console) accent identity: the violet tone, applied
 * on top of the shared theme via the `.godseye` CSS class.
 */
export const godseye = {
  primary: tones.violet.from,
  primarySoft: tones.violet.light.tint,
  primaryStrong: tones.violet.to,
  primaryFg: tones.violet.on,
  /** Dark-mode surfaces for the Godseye shell (same as the shared dark palette). */
  darkBg: c2.dark.canvas,
  darkBgElevated: c2.dark.surface,
} as const;

/**
 * Motion tokens. Mirrored as CSS vars (`--dur-*`, `--ease-*`) in
 * `globals.css`; reference these for JS-driven animation (GSAP, RN).
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
  /** C2 `pop` overshoot (scale 0.6 -> 1.08 -> 1). */
  easePop: "cubic-bezier(0.2, 0.9, 0.3, 1.35)",
  /** C2 `rise` (14px slide-up + fade), staggered 60-80ms. */
  easeRise: "cubic-bezier(0.2, 0.9, 0.3, 1.15)",
  riseStagger: 70,
  /** C2 `press` scale for every pressable. */
  pressScale: 0.97,
} as const;

/** Neutral surfaces, light + dark, in the pre-C2 shape. */
export const neutrals = {
  light: {
    bg: c2.light.canvas,
    bgElevated: c2.light.surface,
    bgMuted: c2.light.surfaceSunken,
    bgSunken: c2.light.surfaceSunken,
    bgOverlay: c2.light.surface,
    border: c2.light.hairline,
    borderStrong: c2.light.control,
    fg: c2.light.ink,
    fgMuted: c2.light.inkMuted,
    fgSubtle: c2.light.inkMuted,
  },
  dark: {
    bg: c2.dark.canvas,
    bgElevated: c2.dark.surface,
    bgMuted: c2.dark.surfaceSunken,
    bgSunken: "#080809",
    bgOverlay: "#1c1c20",
    border: c2.dark.hairline,
    borderStrong: c2.dark.control,
    fg: c2.dark.ink,
    fgMuted: c2.dark.inkMuted,
    fgSubtle: c2.dark.inkMuted,
  },
} as const;

export const semantic = {
  success: tones.green.from,
  successSoft: tones.green.light.tint,
  successFg: tones.green.light.ink,
  warning: tones.amber.from,
  warningSoft: tones.amber.light.tint,
  warningFg: tones.amber.light.ink,
  danger: tones.red.from,
  dangerSoft: tones.red.light.tint,
  dangerFg: tones.red.light.ink,
  info: tones.blue.from,
  infoSoft: tones.blue.light.tint,
  infoFg: tones.blue.light.ink,
} as const;

/**
 * Per-status display tokens for dispatch and bundle. `bg`/`fg` are the light
 * chip pair (native uses them directly); `palette` names the tone so the web
 * badge can pick theme-aware CSS variables instead.
 */
export type StatusTone = {
  bg: string;
  fg: string;
  /** Slightly darker bg for hover/pressed states. */
  bgStrong: string;
  /** Tone label, useful for analytics / a11y. */
  tone: "neutral" | "info" | "warning" | "success" | "danger";
  /** C2 tone family this status renders in. */
  palette: ToneName;
};

function chip(palette: ToneName, tone: StatusTone["tone"], bgStrong: string): StatusTone {
  return { bg: tones[palette].light.tint, fg: tones[palette].light.ink, bgStrong, tone, palette };
}

export const dispatchStatusTones: Record<
  "draft" | "reserved" | "completed" | "cancelled",
  StatusTone
> = {
  draft: chip("amber", "warning", "#ffe39e"),
  reserved: chip("blue", "info", "#c9d9ff"),
  completed: chip("green", "success", "#bdebcb"),
  cancelled: chip("red", "danger", "#f9c9c4"),
};

export const bundleStatusTones: Record<
  "available" | "reserved" | "dispatched" | "void",
  StatusTone
> = {
  available: chip("green", "success", "#bdebcb"),
  reserved: chip("blue", "info", "#c9d9ff"),
  dispatched: chip("neutral", "neutral", "#dcdcd6"),
  void: chip("red", "danger", "#f9c9c4"),
};

/** Roles stay quiet (neutral) except where a tone carries meaning. */
export const roleTones: Record<
  "owner" | "admin" | "manager" | "operator" | "viewer" | "platform",
  StatusTone
> = {
  owner: chip("neutral", "neutral", "#dcdcd6"),
  admin: chip("neutral", "neutral", "#dcdcd6"),
  manager: chip("blue", "info", "#c9d9ff"),
  operator: chip("green", "success", "#bdebcb"),
  viewer: chip("neutral", "neutral", "#dcdcd6"),
  platform: chip("violet", "info", "#ddd0ff"),
};

/** Spacing scale (px). */
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

/**
 * Border radius (px). C2 rule: inputs 12, cards/sheets/dialogs 16, status
 * blocks 22, hero blocks 26, buttons and chips pill. Older keys stay for
 * compatibility.
 */
export const radii = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 16,
  "2xl": 22,
  full: 9999,
  input: 12,
  card: 16,
  block: 22,
  hero: 26,
  pill: 9999,
} as const;

/** Font stacks. Geist lacks Devanagari, so Hindi falls back to Noto/system. */
export const fonts = {
  display: '"Bricolage Grotesque Variable", "Geist Variable", "Noto Sans Devanagari", system-ui, sans-serif',
  body: '"Geist Variable", "Noto Sans Devanagari", system-ui, sans-serif',
  mono: '"Geist Mono Variable", ui-monospace, "SFMono-Regular", Menlo, monospace',
} as const;

/** Typography scale (px). */
export const fontSizes = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 16,
  xl: 20,
  "2xl": 22,
  "3xl": 34,
  "4xl": 44,
} as const;

/** C2 type scale (px): display 34/44/52, title 22, body 15 (16 touch), small 13, micro 11. */
export const typeScale = {
  displaySm: 34,
  displayMd: 44,
  displayLg: 52,
  title: 22,
  body: 15,
  bodyTouch: 16,
  small: 13,
  micro: 11,
} as const;

/** Marketing display sizes. Clamp-based. Web-only (CSS strings). */
export const displaySizes = {
  /** Hero headline: 44px -> 96px. */
  display1: "clamp(2.75rem, 1.4rem + 5.6vw, 6rem)",
  /** Section headline: 32px -> 56px. */
  display2: "clamp(2rem, 1.2rem + 3vw, 3.5rem)",
  /** Sub-section headline: 24px -> 36px. */
  display3: "clamp(1.5rem, 1.2rem + 1.4vw, 2.25rem)",
} as const;

/** Shadows, tinted to ink at low alpha. Web-only; native uses elevation. */
export const shadows = {
  none: "none",
  sm: "0 1px 2px rgba(12, 12, 14, 0.06)",
  md: "0 6px 16px rgba(12, 12, 14, 0.10)",
  lg: "0 10px 24px rgba(12, 12, 14, 0.12)",
  block: "0 10px 24px rgba(12, 12, 14, 0.12)",
  button: "0 6px 16px rgba(12, 12, 14, 0.18)",
} as const;
