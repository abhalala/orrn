/**
 * Type metrics that must hold in Hindi as well as English. Pure (no React
 * Native imports) so __tests__/type-scale.test.ts can check them.
 *
 * Devanagari vowel marks (the े and ं of "करें") sit above the line, and iOS
 * clips them when a fixed line height is tight: titles at 34px on a 40px line
 * lost them on the sign-in screen. Every explicit line height is at least 1.3x
 * its font size.
 */

/** ScreenTitle sizes: 1.35x line heights. */
export const TITLE_SIZES = {
  /** Screens without a native large title (sign-in, scan). */
  lg: "text-[34px] leading-[46px]",
  /** Full-screen messages (offline, no access). */
  md: "text-[30px] leading-[40px]",
} as const;

/** Tailwind's named font sizes in px, as NativeWind compiles them. */
const NAMED_SIZE: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
  "5xl": 48,
  "6xl": 60,
};

/** Tailwind's relative leadings (multiples of the font size). */
const RELATIVE_LEADING: Record<string, number> = {
  none: 1,
  tight: 1.25,
  snug: 1.375,
  normal: 1.5,
  relaxed: 1.625,
  loose: 2,
};

function sizePx(token: string): number | null {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  return NAMED_SIZE[token] ?? null;
}

/**
 * Line height over font size for a class string with both a size and a
 * leading token (`text-[34px] leading-[46px]`, `text-base leading-6`), or null
 * when either is missing. Only the first token of each kind counts.
 */
export function lineHeightRatio(classes: string): number | null {
  let size: number | null = null;
  let leading: { px: number } | { ratio: number } | null = null;
  for (const cls of classes.split(/\s+/)) {
    const s = /^text-(.+)$/.exec(cls)?.[1];
    if (size == null && s) size = sizePx(s);
    const l = /^leading-(.+)$/.exec(cls)?.[1];
    if (leading == null && l) {
      const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(l);
      if (arbitrary) leading = { px: Number(arbitrary[1]) };
      else if (/^\d+(?:\.\d+)?$/.test(l)) leading = { px: Number(l) * 4 };
      else if (RELATIVE_LEADING[l] != null) leading = { ratio: RELATIVE_LEADING[l]! };
    }
  }
  if (size == null || leading == null) return null;
  return "ratio" in leading ? leading.ratio : leading.px / size;
}
