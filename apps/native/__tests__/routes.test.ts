import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { NESTED_STACKS, ROOT_ROUTES, routeForMe } from "../lib/gate";
import { TAB_ROUTES } from "../lib/nav";

const ROOT = join(import.meta.dir, "..");
const APP = join(ROOT, "app");
const ROOT_LAYOUT = readFileSync(join(APP, "_layout.tsx"), "utf8");

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

function layoutsIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...layoutsIn(full));
    else if (/^_layout\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** The root layout's `<Stack.Protected guard={...}>` blocks: guard expression and the ROOT_ROUTES groups inside. */
function protectedBlocks(src: string): { guard: string; groups: string[] }[] {
  return [...src.matchAll(/<Stack\.Protected\s+guard=\{([^}]*)\}\s*>([\s\S]*?)<\/Stack\.Protected>/g)].map((m) => ({
    guard: m[1]!.replace(/\s+/g, " ").trim(),
    groups: [...m[2]!.matchAll(/ROOT_ROUTES\.(\w+)/g)].map((g) => g[1]!),
  }));
}

/** The root `<Stack>` JSX with every Stack.Protected block cut out: what is left is unguarded. */
function unguardedPart(src: string): string {
  const stack = /<Stack screenOptions[\s\S]*?<\/Stack>/.exec(src)?.[0] ?? "";
  return stack.replace(/<Stack\.Protected[\s\S]*?<\/Stack\.Protected>/g, "");
}

describe("route table", () => {
  const declared = [...ROOT_ROUTES.app, ...ROOT_ROUTES.auth, ...ROOT_ROUTES.noAccess, ...ROOT_ROUTES.public];

  test("every root screen on disk is listed in exactly one ROOT_ROUTES group (a new screen must pick one)", () => {
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
    expect(TAB_ROUTES.filter((t) => t.stack).map((t) => t.name)).toEqual(["today", "pack", "stock", "dispatch", "dies", "press", "orders"]);
  });

  test("a link that cold-starts the app (an invite) keeps \"/\" underneath, so Back reaches the gate", () => {
    // Without it the invite screen opened from a link is the only screen in the stack: no way back.
    expect(ROOT_LAYOUT).toMatch(/export const unstable_settings = \{ initialRouteName: "index" \}/);
  });

  test("sign-in lives in the (auth) group and More has a stack", () => {
    expect(existsSync(join(APP, "(auth)", "sign-in.tsx"))).toBe(true);
    expect(existsSync(join(APP, "more", "_layout.tsx"))).toBe(true);
    expect(existsSync(join(APP, "more", "index.tsx"))).toBe(true);
  });
});

describe("gate wiring in app/_layout.tsx (N3)", () => {
  /** Each group opens only on the gate decision that routeForMe returns for it. */
  const expectedGuard = {
    app: `state === "${routeForMe({ user: { mustChangePassword: false }, company: { id: "c" } } as never)}"`,
    auth: `state === "${routeForMe(null)}"`,
    noAccess: `state === "${routeForMe({ user: { mustChangePassword: false }, company: null } as never)}"`,
  };

  test("the expected guards are the three gate routes", () => {
    expect(expectedGuard).toEqual({
      app: 'state === "/(tabs)/today"',
      auth: 'state === "/(auth)/sign-in"',
      noAccess: 'state === "/no-access"',
    });
  });

  test("each guarded ROOT_ROUTES group sits under its own gate decision, once", () => {
    const blocks = protectedBlocks(ROOT_LAYOUT);
    const byGroup = Object.fromEntries(blocks.flatMap((b) => b.groups.map((g) => [g, b.guard])));
    expect(byGroup).toEqual(expectedGuard);
    expect(blocks.map((b) => b.groups.length)).toEqual([1, 1, 1]);
  });

  test("only index and ROOT_ROUTES.public render outside a Stack.Protected", () => {
    const rest = unguardedPart(ROOT_LAYOUT);
    expect(rest).not.toBe("");
    expect([...new Set([...rest.matchAll(/ROOT_ROUTES\.(\w+)/g)].map((m) => m[1]))]).toEqual(["public"]);
    expect([...rest.matchAll(/<Stack\.Screen[^>]*name="([^"]+)"/g)].map((m) => m[1])).toEqual(["index"]);
  });
});

describe("every screen opened from inside the app has a visible way back (WCAG 2.5.1)", () => {
  /**
   * iOS draws a back chevron only when a screen has a previous screen in the
   * same native stack. The first screen of a nested Stack (More, or a T29
   * stack like Dies inside More) has none, and an edge swipe is the only way
   * out, which Switch Control and Voice Control users cannot do. Tab roots are
   * reached from the tab bar; the gate's own screens (sign-in) have no Back by
   * design.
   */
  const nestedLayouts = layoutsIn(APP)
    .map((f) => relative(APP, f))
    .filter((f) => f !== "_layout.tsx" && !f.startsWith("(tabs)/") && !f.startsWith("(auth)/"));

  test("NESTED_STACKS lists exactly the signed-in root screens that are their own Stack", () => {
    const own = ROOT_ROUTES.app.filter((name) => name !== "(tabs)" && existsSync(join(APP, name, "_layout.tsx")));
    expect([...NESTED_STACKS].sort()).toEqual([...own].sort());
  });

  test("every nested Stack outside the tabs and the gate draws HeaderBack on its first screen", () => {
    expect(nestedLayouts).toContain("more/_layout.tsx");
    const missing = nestedLayouts.filter((f) => {
      const src = readFileSync(join(APP, f), "utf8");
      return /<Stack\b/.test(src) && !/headerLeft:\s*\(\)\s*=>\s*<HeaderBack\b/.test(src);
    });
    expect(missing).toEqual([]);
  });

  test("the root Stack hides its header only for nested stacks (a plain pushed screen keeps the native Back)", () => {
    expect(ROOT_LAYOUT).toMatch(/NESTED_STACKS/);
    expect(ROOT_LAYOUT).not.toMatch(/const pushed = \{ headerShown: false \}/);
  });

  test("the avatar navigates to More (a double tap does not stack two More screens)", () => {
    const src = readFileSync(join(ROOT, "components/account-button.tsx"), "utf8");
    expect(src).toMatch(/router\.navigate\("\/more"\)/);
    expect(src).not.toMatch(/router\.push\(/);
  });
});
