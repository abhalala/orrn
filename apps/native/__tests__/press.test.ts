import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { motion } from "@orrn/ui/tokens";

import { pressStyle } from "../lib/press";

const ROOT = join(import.meta.dir, "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("pressStyle (C2 `press` motion)", () => {
  test("at rest the scale is 1", () => {
    expect(pressStyle(false, false).transform).toEqual([{ scale: 1 }]);
  });

  test("pressed scales to the token value", () => {
    expect(pressStyle(true, false).transform).toEqual([{ scale: motion.pressScale }]);
    expect(pressStyle(true, false, 0.95).transform).toEqual([{ scale: 0.95 }]);
  });

  test("reduced motion never scales", () => {
    expect(pressStyle(true, true).transform).toEqual([{ scale: 1 }]);
  });

  test("the change is a Reanimated CSS transition on transform, at the fast duration", () => {
    const style = pressStyle(true, false);
    expect(style.transitionProperty).toBe("transform");
    expect(style.transitionDuration).toBe(motion.durationFast);
  });

  test("it is a plain object NativeWind can merge (no getters, no shared values)", () => {
    const style = pressStyle(true, false);
    expect(JSON.parse(JSON.stringify(style))).toEqual(style);
  });
});

describe("Reanimated styles never pass through NativeWind", () => {
  /**
   * A `useAnimatedStyle` handle given to a component that also takes
   * `className` goes through NativeWind's style merge, which reads every key:
   * in dev Reanimated throws "Perhaps you are trying to pass an animated style
   * to a non-animated component" (the sign-in screen crashed on launch), and in
   * a release build the handle is copied and never animates. Animate with
   * `pressStyle`/`PressableScale` or Reanimated CSS transitions instead, or keep
   * the animated element in a file with no `className`.
   */
  test("no file mixes useAnimatedStyle and className", () => {
    const offenders = ["app", "components", "features", "lib"]
      .flatMap((d) => {
        try {
          return sourceFiles(join(ROOT, d));
        } catch {
          return [];
        }
      })
      .filter((file) => {
        const src = readFileSync(file, "utf8");
        return /\buseAnimatedStyle\s*\(/.test(src) && /\bclassName\b/.test(src);
      })
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  /**
   * NativeWind's Babel JSX transform also runs over node_modules, so a
   * component registered with `cssInterop` is swapped in wherever ANY code
   * renders it. Libraries (keyboard-controller, screens, gesture-handler)
   * render Reanimated's own `Animated.View`/`ScrollView` with
   * `useAnimatedStyle`; registering those crashed the sign-in screen. Register
   * our own `createAnimatedComponent(...)` wrappers instead.
   */
  test("Reanimated's own Animated.* components are never registered with NativeWind", () => {
    const src = readFileSync(join(ROOT, "lib", "nativewind-interop.ts"), "utf8");
    expect(src).not.toMatch(/(cssInterop|remapProps)\(\s*Animated\./);
  });

  test("className goes on the registered twins (AnimatedView...), where NativeWind reads it", () => {
    const offenders = ["app", "components", "features"]
      .flatMap((d) => {
        try {
          return sourceFiles(join(ROOT, d));
        } catch {
          return [];
        }
      })
      .filter((file) => /<Animated\.\w+\b[^>]*\bclassName=/s.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});

describe("every pressable has the C2 press scale (spec section 2)", () => {
  /** The pre-C2 invite kit; T29 rebuilds the invite screen (N4) and deletes it. */
  const LEGACY = new Set(["components/erp.tsx"]);

  test("screens and components build on PressableScale, never a bare Pressable", () => {
    const offenders = ["app", "components", "features"]
      .flatMap((d) => {
        try {
          return sourceFiles(join(ROOT, d));
        } catch {
          return [];
        }
      })
      .map((file) => relative(ROOT, file))
      .filter((rel) => rel !== "components/ui/pressable-scale.tsx" && !LEGACY.has(rel))
      .filter((rel) => /<Pressable\b/.test(readFileSync(join(ROOT, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
