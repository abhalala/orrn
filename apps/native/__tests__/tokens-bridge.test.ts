import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { c2, radii, tones, type ToneName } from "@orrn/ui/tokens";

import { themeColor } from "../lib/theme-colors";

// tailwind.config.js is CommonJS and has no types.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require("../tailwind.config.js") as {
  theme: { extend: { colors: Record<string, any>; borderRadius: Record<string, string>; fontFamily: Record<string, string[]> } };
  plugins: { handler: (api: { addBase: (rules: Record<string, Record<string, string>>) => void }) => void }[];
};

const toneNames = Object.keys(tones) as ToneName[];

/** Run the theme-variables plugin and capture the base rules it emits. */
function baseRules() {
  let rules: Record<string, Record<string, string>> = {};
  for (const p of config.plugins) p.handler({ addBase: (r) => (rules = { ...rules, ...r }) });
  return rules;
}

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

describe("native token bridge", () => {
  const rules = baseRules();

  test("light and dark canvas equal tokens.ts", () => {
    expect(rules[":root"]["--canvas"]).toBe(channels(c2.light.canvas));
    expect(rules[".dark:root"]["--canvas"]).toBe(channels(c2.dark.canvas));
    expect(rules[":root"]["--ink"]).toBe(channels(c2.light.ink));
    expect(rules[".dark:root"]["--ink"]).toBe(channels(c2.dark.ink));
  });

  test("every tone exposes from/to/on/tint/ink in both themes", () => {
    const tone = config.theme.extend.colors.tone;
    expect(Object.keys(tone).sort()).toEqual([...toneNames].sort());
    for (const name of toneNames) {
      expect(Object.keys(tone[name]).sort()).toEqual(["DEFAULT", "from", "ink", "on", "tint", "to"]);
      expect(rules[":root"][`--tone-${name}-tint`]).toBe(channels(tones[name].light.tint));
      expect(rules[".dark:root"][`--tone-${name}-tint`]).toBe(channels(tones[name].dark.tint));
      expect(rules[".dark:root"][`--tone-${name}-ink`]).toBe(channels(tones[name].dark.ink));
      expect(rules[".dark:root"][`--tone-${name}-on`]).toBe(channels(tones[name].on));
    }
  });

  test("web semantic names exist and point at the token variables", () => {
    const colors = config.theme.extend.colors;
    for (const key of ["canvas", "background", "foreground", "hairline", "border", "control"]) {
      expect(colors[key]).toBeDefined();
    }
    expect(colors.card.DEFAULT).toContain("--surface)");
    expect(colors.primary.DEFAULT).toContain("--ink)");
    expect(colors.muted.foreground).toContain("--ink-muted)");
    expect(colors.destructive.DEFAULT).toContain("--destructive)");
    expect(colors.tone.green.tint).toContain("--tone-green-tint)");
    // Every colour keeps the alpha placeholder so `bg-destructive/10` works.
    const leaves: string[] = [];
    const walk = (v: unknown) =>
      typeof v === "string" ? leaves.push(v) : Object.values(v as object).forEach(walk);
    walk(colors);
    for (const leaf of leaves) expect(leaf).toMatch(/^rgb\(var\(--[a-z-]+\) \/ <alpha-value>\)$/);
  });

  test("radius scale equals tokens.ts radii", () => {
    for (const [key, px] of Object.entries(radii)) {
      expect(config.theme.extend.borderRadius[key]).toBe(`${px}px`);
    }
  });

  test("every font family the config exposes is loaded by lib/fonts.ts", () => {
    const { fontFamily } = config.theme.extend;
    for (const key of ["display", "sans", "mono"]) expect(fontFamily[key]).toBeDefined();
    // lib/fonts.ts `require`s .ttf files, which bun cannot import: read its keys as text.
    const src = readFileSync(join(import.meta.dir, "../lib/fonts.ts"), "utf8");
    const loaded = [...src.matchAll(/^\s+([A-Za-z]+_\d+[A-Za-z]+): require\(/gm)].map((m) => m[1]);
    expect(loaded.length).toBeGreaterThan(0);
    for (const names of Object.values(fontFamily)) expect(loaded).toContain(names[0]);
    for (const family of loaded) {
      expect(Object.values(fontFamily).some((n) => n[0] === family)).toBe(true);
    }
  });

  test("useThemeColor lookup reads tokens", () => {
    expect(themeColor("light", "background")).toBe(c2.light.canvas);
    expect(themeColor("dark", "muted-foreground")).toBe(c2.dark.inkMuted);
  });
});
