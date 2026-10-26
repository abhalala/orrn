/**
 * Tailwind config for the native app (Tailwind 3 + NativeWind 4).
 *
 * Every colour, radius and font name here comes from the shared tokens in
 * `packages/ui/src/tokens.ts` (via `tokens-bridge.js`); nothing is copied by
 * hand. The semantic class names match the web theme (`globals.css`), so a
 * shared `className` resolves to the same colour on both platforms:
 *
 *   bg-canvas bg-surface bg-surface-sunken text-ink text-ink-muted
 *   border-hairline border-control
 *   bg-background text-foreground bg-card text-muted-foreground border-border
 *   bg-primary (ink pill) text-primary-foreground bg-destructive text-destructive
 *   bg-tone-green  bg-tone-green-tint  text-tone-green-ink  text-tone-green-on
 *     (also blue / amber / red / violet / neutral; `bg-tone-x` is the gradient's
 *      lighter stop, NativeWind has no linear gradients)
 *   rounded-input rounded-card rounded-block rounded-hero rounded-full
 *   font-display font-sans font-mono (+ -medium / -semibold / -bold weights)
 *
 * Colours are exposed as `rgb(var(--name) / <alpha-value>)` so opacity
 * modifiers (`bg-destructive/10`) work. The `--name` variables are emitted by
 * the `themeVariables` plugin below: light under `:root`, dark under
 * `.dark:root`, which is the selector pair NativeWind 4 toggles with
 * `setColorScheme()`.
 */
const plugin = require("tailwindcss/plugin");
const { c2, dangerText, neutrals, radii, tones } = require("./tokens-bridge");

const toneNames = Object.keys(tones);

/** "#rrggbb" -> "r g b" (the channel form `rgb(var(--x) / <alpha-value>)` needs). */
function channels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

/** CSS custom properties for one theme, as { "--name": "r g b" }. */
function themeVars(mode) {
  const s = c2[mode];
  const vars = {
    canvas: s.canvas,
    surface: s.surface,
    "surface-sunken": s.surfaceSunken,
    ink: s.ink,
    "ink-muted": s.inkMuted,
    hairline: s.hairline,
    control: s.control,
    // shadcn layer, same mapping as packages/ui/src/styles/globals.css
    popover: mode === "dark" ? neutrals.dark.bgOverlay : s.surface,
    // Text on an ink pill: white on light, canvas on dark.
    "primary-foreground": mode === "dark" ? c2.dark.canvas : c2.light.surface,
    destructive: dangerText[mode],
    "destructive-foreground": mode === "dark" ? c2.dark.canvas : c2.light.surface,
  };
  for (const name of toneNames) {
    const t = tones[name];
    // Gradient stops and on-block text are the same in both themes.
    vars[`tone-${name}-from`] = t.from;
    vars[`tone-${name}-to`] = t.to;
    vars[`tone-${name}-on`] = t.on;
    vars[`tone-${name}-tint`] = t[mode].tint;
    vars[`tone-${name}-ink`] = t[mode].ink;
  }
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [`--${k}`, channels(v)]));
}

const themeVariables = plugin(({ addBase }) => {
  addBase({ ":root": themeVars("light"), ".dark:root": themeVars("dark") });
});

const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

const toneColors = Object.fromEntries(
  toneNames.map((name) => [
    name,
    {
      DEFAULT: v(`tone-${name}-from`),
      from: v(`tone-${name}-from`),
      to: v(`tone-${name}-to`),
      on: v(`tone-${name}-on`),
      tint: v(`tone-${name}-tint`),
      ink: v(`tone-${name}-ink`),
    },
  ]),
);

/** Font-family names registered in `lib/fonts.ts` (one family per weight). */
const fontFamily = {
  display: ["BricolageGrotesque_600SemiBold"],
  "display-bold": ["BricolageGrotesque_700Bold"],
  "display-extrabold": ["BricolageGrotesque_800ExtraBold"],
  sans: ["Geist_400Regular"],
  "sans-medium": ["Geist_500Medium"],
  "sans-semibold": ["Geist_600SemiBold"],
  "sans-bold": ["Geist_700Bold"],
  mono: ["GeistMono_400Regular"],
  "mono-medium": ["GeistMono_500Medium"],
  "mono-semibold": ["GeistMono_600SemiBold"],
};

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./features/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        surface: { DEFAULT: v("surface"), sunken: v("surface-sunken") },
        ink: { DEFAULT: v("ink"), muted: v("ink-muted") },
        hairline: v("hairline"),
        control: v("control"),
        background: v("canvas"),
        foreground: v("ink"),
        card: { DEFAULT: v("surface"), foreground: v("ink") },
        popover: { DEFAULT: v("popover"), foreground: v("ink") },
        primary: { DEFAULT: v("ink"), foreground: v("primary-foreground") },
        secondary: { DEFAULT: v("surface-sunken"), foreground: v("ink") },
        muted: { DEFAULT: v("surface-sunken"), foreground: v("ink-muted") },
        accent: { DEFAULT: v("surface-sunken"), foreground: v("ink") },
        destructive: { DEFAULT: v("destructive"), foreground: v("destructive-foreground") },
        border: v("hairline"),
        input: v("control"),
        ring: v("ink"),
        tone: toneColors,
      },
      borderRadius: Object.fromEntries(Object.entries(radii).map(([k, px]) => [k, `${px}px`])),
      fontFamily,
    },
  },
  plugins: [themeVariables],
};
