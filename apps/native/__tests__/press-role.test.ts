import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { can, type Action, type Me } from "@orrn/server/lib/permissions";

import { moreRows } from "../features/more/more-rows";
import { PRESS_REFUSALS } from "../features/press/press-model";
import { extraTabs, placeScan, reachableTabs, tabSetFor, visibleTabs, type TabName } from "../lib/nav";

/**
 * W4-NATIVE-C: the press role, end to end, without a device: the tab bar it gets, the routes behind each
 * tab, what its permissions allow, and the screens it reaches (read only; downtime and handover are the only
 * writes). BACKLOG 29 "press role gets the press tab set".
 */

const NATIVE = join(import.meta.dir, "..");
const read = (rel: string) => readFileSync(join(NATIVE, rel), "utf8");

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = []): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

const PRESS = me("press");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((e) => {
    const p = join(dir, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) ? [p] : [];
  });
}

describe("the press role's tab bar", () => {
  test("Today, Press, Scan (centred), Dies, More; nothing else", () => {
    expect(tabSetFor(PRESS)).toBe("press");
    expect(visibleTabs(PRESS)).toEqual(["today", "press", "scan", "dies", "menu"]);
    expect(placeScan(visibleTabs(PRESS))).toEqual(["today", "press", "scan", "dies", "menu"]);
  });

  test("the tabs a press operator must not reach are not reachable, by link either", () => {
    const reach = new Set(reachableTabs(PRESS));
    for (const hidden of ["pack", "stock", "dispatch", "orders"] as TabName[]) expect(reach.has(hidden)).toBe(false);
    expect(extraTabs(PRESS)).toEqual([]);
  });

  test("More has no duplicate of a tab already on the bar and no die-room-only row", () => {
    const rows = moreRows(PRESS).map((r) => r.key);
    expect(rows).not.toContain("press");
    expect(rows).not.toContain("dieRoom");
    expect(rows).not.toContain("orders");
  });

  test("a plant without the press or dies module drops that tab, keeping Today, Scan and More", () => {
    expect(visibleTabs(me("press", ["bundles"]))).toEqual(["today", "scan", "menu"]);
    expect(visibleTabs(me("press", ["press"]))).toEqual(["today", "press", "menu"]);
    expect(visibleTabs(me("press", ["press", "dies", "bundles"]))).toEqual(["today", "press", "scan", "dies", "menu"]);
  });

  test("every tab on the bar has a screen behind it, and the layout hides the rest with Tabs.Protected", () => {
    for (const tab of visibleTabs(PRESS)) {
      const base = join(NATIVE, "app", "(tabs)", tab === "menu" ? "menu" : tab);
      expect({ tab, exists: existsSync(base) || existsSync(`${base}.tsx`) }).toEqual({ tab, exists: true });
    }
    const layout = read("app/(tabs)/_layout.tsx");
    expect(layout).toMatch(/reachableTabs\(me\)/);
    expect(layout).toMatch(/Tabs\.Protected/);
    expect(layout).toMatch(/guard=\{visible\.has\(tab\.name\)\}/);
  });

  test("the Press tab opens lines, one line and one run, each a route", () => {
    for (const rel of ["app/(tabs)/press/_layout.tsx", "app/(tabs)/press/index.tsx", "app/(tabs)/press/line/[id].tsx", "app/(tabs)/press/run/[id].tsx"]) {
      expect({ rel, exists: existsSync(join(NATIVE, rel)) }).toEqual({ rel, exists: true });
    }
  });
});

describe("what the press role's permissions allow on the phone", () => {
  const allowed: Action[] = ["press.run", "die.reading"];
  const refused: Action[] = ["press.close", "die.issue", "die.maker", "die.card", "order.manage", "order.plan", "dispatch.create", "dispatch.complete", "bundle.void", "settings.update"];

  test("press.run and die.reading yes", () => {
    for (const a of allowed) expect({ a, ok: can(PRESS, a) }).toEqual({ a, ok: true });
  });

  test("closing a run, issuing dies, orders, dispatch, voiding and settings no", () => {
    for (const a of refused) expect({ a, ok: can(PRESS, a) }).toEqual({ a, ok: false });
  });

  test("the roles that only read the press cannot write downtime or handover", () => {
    for (const role of ["manager", "admin", "packer", "viewer"] as const) expect({ role, ok: can(me(role), "press.run") }).toEqual({ role, ok: false });
    expect(can(me("supervisor"), "press.run")).toBe(true);
  });
});

describe("the press screens are read only; downtime and handover are the only writes", () => {
  const dirs = ["features/press", "app/(tabs)/press"].flatMap((d) => walk(join(NATIVE, d)));

  test("the files that send a write are the downtime panel and the handover sheet, and nothing else under the press tab", () => {
    const writers = dirs.filter((f) => /mutationOptions|useMutation/.test(readFileSync(f, "utf8"))).map((f) => f.slice(NATIVE.length + 1)).sort();
    expect(writers).toEqual(["features/press/downtime-panel.tsx", "features/press/handover-sheet.tsx"]);
  });

  test("the run screen starts, stops and counts nothing: it only reads the run and says where the station is", () => {
    const run = read("features/press/run-view.tsx");
    expect(/useMutation|mutationOptions|\.mutate/.test(run)).toBe(false);
    expect(/trpc\.press\.runs\.get\.queryOptions/.test(run)).toBe(true);
    expect(/press\.console\.(start|stop|count)\b/.test(run)).toBe(false);
  });

  test("both writes sit behind press.run: the panel in <Can>, the sheet in roleHolds", () => {
    expect(read("features/press/downtime-panel.tsx")).toMatch(/<Can do="press\.run">/);
    expect(read("features/press/handover-sheet.tsx")).toMatch(/roleHolds\(asRole\(role\), "press\.run"\)/);
    expect(read("features/press/run-view.tsx")).toMatch(/<Can do="press\.run">/);
  });

  test("a refused downtime or handover is said in the person's language, never the server's English", () => {
    for (const f of ["features/press/downtime-panel.tsx", "features/press/handover-sheet.tsx"]) {
      const src = read(f);
      expect(src).toMatch(/pressError\(t, error\)/);
      expect(src).not.toMatch(/error\.message|\.message\}/);
    }
    expect(PRESS_REFUSALS.length).toBeGreaterThan(8);
  });

  test("scanning a die label opens the card or a queued run read only, for a person who can reach Dies", () => {
    const scan = read("features/scan/scan-view.tsx");
    expect(scan).toMatch(/reachableTabs\(/);
    expect(scan).not.toMatch(/press\.runs\.(start|stop|count)/);
  });
});
