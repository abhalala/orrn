import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { stackOptions } from "../lib/stack-options";

const colors = { canvas: "#f4f4f0", ink: "#0d0d0f" };

describe("stack header options", () => {
  /**
   * Seen on the iOS 27 simulator (react-native-screens 4.23): with an opaque
   * `headerStyle.backgroundColor` the iOS large title is laid out but never
   * drawn, so Today, Pack, Stock, Dispatch and More showed no title at all.
   * iOS keeps the system bar (clear over the canvas at the top, glass once
   * scrolled); Android has no large title and needs the colour.
   */
  test("iOS sets no header background, so the large title is drawn", () => {
    const ios = stackOptions({ os: "ios", ...colors });
    expect(ios).not.toHaveProperty("headerStyle");
  });

  test("Android paints the header with the canvas", () => {
    expect(stackOptions({ os: "android", ...colors }).headerStyle).toEqual({ backgroundColor: colors.canvas });
  });

  test("titles use Bricolage and the ink colour on both platforms", () => {
    for (const os of ["ios", "android"]) {
      const o = stackOptions({ os, ...colors });
      expect(o.headerTitleStyle).toEqual({ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: colors.ink });
      expect(o.headerLargeTitleStyle).toEqual({ fontFamily: "BricolageGrotesque_800ExtraBold", color: colors.ink });
      expect(o.headerTintColor).toBe(colors.ink);
      expect(o.contentStyle).toEqual({ backgroundColor: colors.canvas });
    }
  });

  test("useStackOptions is stackOptions over Platform.OS and the theme", () => {
    const src = readFileSync(join(import.meta.dir, "..", "lib/screen-options.ts"), "utf8");
    expect(src).toMatch(/stackOptions\(\{\s*os: Platform\.OS/);
    expect(src).not.toMatch(/headerStyle/);
  });
});
