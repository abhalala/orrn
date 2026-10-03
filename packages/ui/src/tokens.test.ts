import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { contrastRatio, lighterOf } from "./lib/contrast";
import {
  bundleStatusTones,
  c2,
  dangerText,
  dispatchStatusTones,
  inkPanel,
  roleTones,
  tones,
  type ToneName,
} from "./tokens";

const AA_TEXT = 4.5;
const AA_UI = 3;
const themes = ["light", "dark"] as const;
const toneNames = Object.keys(tones) as ToneName[];

describe("contrast helper", () => {
  test("matches known WCAG values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Tailwind green-600 with white text is a well-known AA failure (3.30).
    expect(contrastRatio("#ffffff", "#16a34a")).toBeCloseTo(3.3, 1);
    expect(lighterOf("#ffc21a", "#ff9500")).toBe("#ffc21a");
  });
});

describe("tone blocks", () => {
  for (const name of toneNames) {
    const tone = tones[name];
    test(`${name}: on-block text vs lighter stop >= 4.5`, () => {
      expect(contrastRatio(tone.on, lighterOf(tone.from, tone.to))).toBeGreaterThanOrEqual(AA_TEXT);
    });
    test(`${name}: on-block text vs both stops >= 4.5`, () => {
      expect(contrastRatio(tone.on, tone.from)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(tone.on, tone.to)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }
});

describe("tone chips", () => {
  for (const name of toneNames) {
    for (const theme of themes) {
      test(`${name} chip ink vs tint (${theme}) >= 4.5`, () => {
        const { tint, ink } = tones[name][theme];
        expect(contrastRatio(ink, tint)).toBeGreaterThanOrEqual(AA_TEXT);
      });
    }
  }

  test("status/role chip pairs used by native stay >= 4.5", () => {
    for (const map of [dispatchStatusTones, bundleStatusTones, roleTones]) {
      for (const tone of Object.values(map)) {
        expect(contrastRatio(tone.fg, tone.bg)).toBeGreaterThanOrEqual(AA_TEXT);
        expect(contrastRatio(tone.fg, tone.bgStrong)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    }
  });
});

describe("surfaces", () => {
  for (const theme of themes) {
    const p = c2[theme];
    test(`ink-muted vs canvas, surface, sunken (${theme}) >= 4.5`, () => {
      expect(contrastRatio(p.inkMuted, p.canvas)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.inkMuted, p.surface)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.inkMuted, p.surfaceSunken)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    test(`ink vs canvas and surface (${theme}) >= 4.5`, () => {
      expect(contrastRatio(p.ink, p.canvas)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    test(`form-control boundary and focus ring (${theme}) >= 3`, () => {
      expect(contrastRatio(p.control, p.canvas)).toBeGreaterThanOrEqual(AA_UI);
      expect(contrastRatio(p.control, p.surface)).toBeGreaterThanOrEqual(AA_UI);
      // Focus ring is ink, 2px with 2px offset.
      expect(contrastRatio(p.ink, p.canvas)).toBeGreaterThanOrEqual(AA_UI);
      expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(AA_UI);
    });
    test(`primary ink pill label (${theme}) >= 4.5`, () => {
      // Primary button = ink fill with canvas/white label (inverted in dark).
      const label = theme === "light" ? "#ffffff" : c2.dark.canvas;
      expect(contrastRatio(label, p.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    });
    test(`danger text (${theme}) >= 4.5 on canvas and surface`, () => {
      expect(contrastRatio(dangerText[theme], p.canvas)).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(dangerText[theme], p.surface)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  }

  test("ink panel (sidebar) text >= 4.5, ring >= 3", () => {
    expect(contrastRatio(inkPanel.fg, inkPanel.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(inkPanel.fgMuted, inkPanel.bg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(inkPanel.fgMuted, inkPanel.bgRaised)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(inkPanel.activeFg, inkPanel.activeBg)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(inkPanel.fg, inkPanel.bg)).toBeGreaterThanOrEqual(AA_UI);
  });

  test("Godseye violet ring is visible on both canvases", () => {
    expect(contrastRatio(tones.violet.to, c2.light.canvas)).toBeGreaterThanOrEqual(AA_UI);
    expect(contrastRatio(tones.violet.dark.ink, c2.dark.canvas)).toBeGreaterThanOrEqual(AA_UI);
  });
});

/**
 * The CSS bridge must mirror tokens.ts. Parse the two theme blocks of
 * globals.css and compare the C2 variables to the token values.
 */
describe("globals.css mirrors tokens.ts", () => {
  const css = readFileSync(join(import.meta.dir, "styles/globals.css"), "utf8");
  const block = (selector: string) => {
    const start = css.indexOf(`${selector} {`);
    if (start === -1) throw new Error(`missing ${selector} block`);
    return css.slice(start, css.indexOf("}", start));
  };
  const varIn = (src: string, name: string) =>
    src.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim().toLowerCase();

  for (const [selector, theme] of [
    [":root", "light"],
    [".dark", "dark"],
  ] as const) {
    test(`${selector} surface vars`, () => {
      const src = block(selector);
      const p = c2[theme];
      expect(varIn(src, "canvas")).toBe(p.canvas);
      expect(varIn(src, "surface")).toBe(p.surface);
      expect(varIn(src, "surface-sunken")).toBe(p.surfaceSunken);
      expect(varIn(src, "ink")).toBe(p.ink);
      expect(varIn(src, "ink-muted")).toBe(p.inkMuted);
      expect(varIn(src, "hairline")).toBe(p.hairline);
      expect(varIn(src, "control")).toBe(p.control);
      expect(varIn(src, "destructive")).toBe(dangerText[theme]);
    });
    test(`${selector} chip vars`, () => {
      const src = block(selector);
      for (const name of toneNames) {
        expect(varIn(src, `tone-${name}-tint`)).toBe(tones[name][theme].tint);
        expect(varIn(src, `tone-${name}-ink`)).toBe(tones[name][theme].ink);
      }
    });
  }

  test(":root block gradient vars", () => {
    const src = block(":root");
    for (const name of toneNames) {
      expect(varIn(src, `tone-${name}-from`)).toBe(tones[name].from);
      expect(varIn(src, `tone-${name}-to`)).toBe(tones[name].to);
      expect(varIn(src, `tone-${name}-on`)).toBe(tones[name].on);
    }
  });
});
