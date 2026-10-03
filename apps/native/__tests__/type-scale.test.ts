import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx$/.test(entry)) out.push(full);
  }
  return out;
}

/** Tailwind's named sizes and leadings, in px, as NativeWind compiles them. */
const NAMED_SIZE: Record<string, number> = { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, "2xl": 24, "3xl": 30, "4xl": 36 };

function px(sizeToken: string): number | null {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(sizeToken);
  if (arbitrary) return Number(arbitrary[1]);
  return NAMED_SIZE[sizeToken] ?? null;
}

function leadingPx(token: string): number | null {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(token);
  if (arbitrary) return Number(arbitrary[1]);
  if (/^\d+$/.test(token)) return Number(token) * 4;
  return null;
}

describe("type scale", () => {
  /**
   * Hindi is a first-class language: Devanagari vowel marks (the े and ं of
   * "करें") sit above the line, and iOS clips them when a fixed line height is
   * tight. Titles at 34px with a 40px line lost them on the sign-in screen.
   * Any explicit line height needs 1.3x the font size; display text should use
   * `ScreenTitle`, which already does.
   */
  test("explicit line heights leave room for Devanagari marks (at least 1.3x)", () => {
    const tooTight: string[] = [];
    for (const file of ["app", "components", "features"].flatMap((d) => {
      try {
        return sourceFiles(join(ROOT, d));
      } catch {
        return [];
      }
    })) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(/className=(?:"([^"]*)"|\{[^}]*?"([^"]*)")/g)) {
        const classes = (match[1] ?? match[2] ?? "").split(/\s+/);
        const size = classes.map((c) => /^text-(.+)$/.exec(c)?.[1]).map((s) => (s ? px(s) : null)).find((n) => n != null);
        const leading = classes.map((c) => /^leading-(.+)$/.exec(c)?.[1]).map((s) => (s ? leadingPx(s) : null)).find((n) => n != null);
        if (size && leading && leading / size < 1.3) {
          tooTight.push(`${relative(ROOT, file)}: text ${size}px on a ${leading}px line`);
        }
      }
    }
    expect(tooTight).toEqual([]);
  });
});
