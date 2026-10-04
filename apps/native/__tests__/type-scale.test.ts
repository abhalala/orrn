import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { lineHeightRatio, TITLE_SIZES } from "../lib/type-scale";

const ROOT = join(import.meta.dir, "..");

function sourceFiles(dir: string, pattern = /\.tsx?$/): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, pattern));
    else if (pattern.test(entry)) out.push(full);
  }
  return out;
}

function filesUnder(dirs: string[], pattern?: RegExp): string[] {
  return dirs.flatMap((d) => {
    try {
      return sourceFiles(join(ROOT, d), pattern);
    } catch {
      return [];
    }
  });
}

/** Every quoted string literal ("...", '...', `...`) in a source file. */
function stringLiterals(src: string): string[] {
  return [...src.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
}

describe("type scale", () => {
  /**
   * Hindi is a first-class language: Devanagari vowel marks (the े and ं of
   * "करें") sit above the line, and iOS clips them when a fixed line height is
   * tight. Titles at 34px with a 40px line lost them on the sign-in screen.
   * Any explicit line height needs 1.3x the font size.
   */
  test("every ScreenTitle size leaves room for Devanagari marks (at least 1.3x)", () => {
    const entries = Object.entries(TITLE_SIZES);
    expect(entries.length).toBeGreaterThan(0);
    for (const [name, classes] of entries) {
      const ratio = lineHeightRatio(classes);
      expect({ name, ok: ratio != null && ratio >= 1.3 }).toEqual({ name, ok: true });
    }
  });

  test("lineHeightRatio reads arbitrary and named sizes and leadings", () => {
    expect(lineHeightRatio("text-[34px] leading-[40px]")).toBeCloseTo(40 / 34);
    expect(lineHeightRatio("font-sans text-base leading-6 text-ink-muted")).toBeCloseTo(24 / 16);
    expect(lineHeightRatio("text-[11px] leading-4")).toBeCloseTo(16 / 11);
    expect(lineHeightRatio("text-ink text-lg")).toBeNull();
  });

  test("no string literal anywhere pairs a font size with a line under 1.3x (className, cn(), size tables)", () => {
    const tooTight: string[] = [];
    for (const file of filesUnder(["app", "components", "features", "lib"])) {
      for (const literal of stringLiterals(readFileSync(file, "utf8"))) {
        const ratio = lineHeightRatio(literal);
        if (ratio != null && ratio < 1.3) tooTight.push(`${relative(ROOT, file)}: "${literal}"`);
      }
    }
    expect(tooTight).toEqual([]);
  });
});

describe("Dynamic Type", () => {
  /**
   * Brief a11y item 8: `allowFontScaling` stays on and caps are for big display
   * text only. The tab bar (11pt labels, five across), the avatar initials and
   * the wordmark may cap low; screen titles may stop at 2x (WCAG 1.4.4's 200%);
   * everything else, buttons included, grows with the person's text size.
   */
  const LOW_CAP_ALLOWED = new Set([
    "components/tab-bar.tsx",
    "components/account-button.tsx",
    "components/brand-mark.tsx",
    "app/more/index.tsx",
  ]);

  test("maxFontSizeMultiplier below 2 only on the tab bar, initials and wordmark", () => {
    const offenders: string[] = [];
    for (const file of filesUnder(["app", "components", "features"], /\.tsx$/)) {
      const rel = relative(ROOT, file);
      for (const m of readFileSync(file, "utf8").matchAll(/maxFontSizeMultiplier=\{([\d.]+)\}/g)) {
        if (Number(m[1]) < 2 && !LOW_CAP_ALLOWED.has(rel)) offenders.push(`${rel}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("buttons never cap the label", () => {
    expect(readFileSync(join(ROOT, "components/ui/button.tsx"), "utf8")).not.toMatch(/maxFontSizeMultiplier/);
  });
});
