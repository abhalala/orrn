import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { ROOT_ROUTES } from "../lib/gate";
import { TAB_ROUTES } from "../lib/nav";

const APP = join(import.meta.dir, "..", "app");

/**
 * The screen names expo-router gives the root Stack: a file is its own name, a
 * folder with a `_layout` is one screen, a folder without one contributes its
 * files as "folder/file". `_layout` and `+special` files are not screens.
 */
function screensIn(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    if (entry.startsWith("_") || entry.startsWith("+")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hasLayout = readdirSync(full).some((f) => /^_layout\.tsx?$/.test(f));
      if (hasLayout) out.push(prefix + entry);
      else out.push(...screensIn(full, `${prefix}${entry}/`));
    } else if (/\.tsx?$/.test(entry)) {
      out.push(prefix + entry.replace(/\.tsx?$/, ""));
    }
  }
  return out;
}

describe("route table", () => {
  const declared = [...ROOT_ROUTES.app, ...ROOT_ROUTES.auth, ...ROOT_ROUTES.noAccess, ...ROOT_ROUTES.public];

  test("every root screen is behind exactly one gate (a new screen must pick one)", () => {
    const onDisk = screensIn(APP);
    expect([...onDisk].sort()).toEqual([...declared].sort());
    expect(new Set(declared).size).toBe(declared.length);
  });

  test("the drawer is gone (N1)", () => {
    expect(existsSync(join(APP, "(drawer)"))).toBe(false);
  });

  test("tenant screens are the tabs and More; sign-in and no-access stand alone", () => {
    expect(ROOT_ROUTES.app).toContain("(tabs)");
    expect(ROOT_ROUTES.app).toContain("more");
    expect(ROOT_ROUTES.auth).toEqual(["(auth)"]);
    expect(ROOT_ROUTES.noAccess).toEqual(["no-access"]);
  });

  test("each tab has a screen; tabs with detail pages have their own stack", () => {
    for (const tab of TAB_ROUTES) {
      if (tab.stack) {
        expect(existsSync(join(APP, "(tabs)", tab.name, "_layout.tsx"))).toBe(true);
        expect(existsSync(join(APP, "(tabs)", tab.name, "index.tsx"))).toBe(true);
      } else {
        expect(existsSync(join(APP, "(tabs)", `${tab.name}.tsx`))).toBe(true);
      }
    }
    expect(TAB_ROUTES.filter((t) => t.stack).map((t) => t.name)).toEqual(["today", "pack", "stock", "dispatch"]);
  });

  test("sign-in lives in the (auth) group and More has a stack", () => {
    expect(existsSync(join(APP, "(auth)", "sign-in.tsx"))).toBe(true);
    expect(existsSync(join(APP, "more", "_layout.tsx"))).toBe(true);
    expect(existsSync(join(APP, "more", "index.tsx"))).toBe(true);
  });
});
