import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { can, type Me } from "@orrn/server/lib/permissions";

import { moreRows } from "../features/more/more-rows";
import { extraTabs, placeScan, reachableTabs, TAB_ROUTES, TAB_SETS, tabSetFor, visibleTabs } from "../lib/nav";

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = []): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

describe("native tabs", () => {
  test("declared order keeps the packer set first, then the die room and office tabs, then More", () => {
    expect(TAB_ROUTES.map((t) => t.name)).toEqual(["today", "pack", "scan", "stock", "dispatch", "dies", "press", "cast", "orders", "menu"]);
  });

  test("an owner sees every tab", () => {
    expect(visibleTabs(me("owner"))).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
  });

  test("a viewer cannot pack, so Pack is hidden (same rule as the web tab bar)", () => {
    expect(visibleTabs(me("viewer"))).toEqual(["today", "scan", "stock", "dispatch"]);
  });

  test("company modules hide tabs; an empty module list means everything is on", () => {
    expect(visibleTabs(me("owner", ["dispatches"]))).toEqual(["today", "dispatch"]);
    expect(visibleTabs(me("owner", ["BUNDLES"]))).toEqual(["today", "pack", "scan", "stock"]);
  });

  test("signed out or no company shows Today only", () => {
    expect(visibleTabs(null)).toEqual(["today"]);
  });
});

describe("placeScan", () => {
  test("Scan sits in the middle of whatever tabs are visible", () => {
    expect(placeScan(["today", "pack", "scan", "stock", "dispatch"])).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
    expect(placeScan(["today", "scan", "stock", "dispatch"])).toEqual(["today", "scan", "stock", "dispatch"]);
    expect(placeScan(["today", "pack", "scan", "stock"])).toEqual(["today", "scan", "pack", "stock"]);
    expect(placeScan(["today", "dispatch"])).toEqual(["today", "dispatch"]);
  });
});

describe("role-aware tab sets (spec E1, E2 Native)", () => {
  test("die_room gets Today, Dies, Scan, Press, More", () => {
    expect(tabSetFor(me("die_room"))).toBe("dieRoom");
    expect(placeScan(visibleTabs(me("die_room")))).toEqual(["today", "dies", "scan", "press", "menu"]);
  });

  test("office gets Today, Dispatch, Scan, Orders, More", () => {
    expect(tabSetFor(me("office"))).toBe("office");
    expect(placeScan(visibleTabs(me("office")))).toEqual(["today", "dispatch", "scan", "orders", "menu"]);
  });

  test("press gets Today, Press, Scan, Dies, More (spec E3 Native); the station itself is the tablet", () => {
    expect(tabSetFor(me("press"))).toBe("press");
    expect(placeScan(visibleTabs(me("press")))).toEqual(["today", "press", "scan", "dies", "menu"]);
    // A plant without the press module has no Press tab; one without dies has no Dies tab.
    expect(placeScan(visibleTabs(me("press", ["press", "bundles"])))).toEqual(["today", "scan", "press", "menu"]);
    expect(placeScan(visibleTabs(me("press", ["press", "dies", "bundles"])))).toEqual(["today", "press", "scan", "dies", "menu"]);
  });

  test("foundry gets Today, Cast, Scan, Stock, More (spec FD Native); Scan sits in the middle", () => {
    expect(tabSetFor(me("foundry"))).toBe("foundry");
    expect(placeScan(visibleTabs(me("foundry")))).toEqual(["today", "cast", "scan", "stock", "menu"]);
  });

  test("every other role keeps the packer set, including owner, manager, supervisor and packer", () => {
    for (const role of ["owner", "admin", "manager", "supervisor", "packer", "viewer", "operator", "accountant", "storekeeper"] as const) {
      expect(tabSetFor(me(role))).toBe("floor");
      expect(visibleTabs(me(role)).every((t) => TAB_SETS.floor.includes(t))).toBe(true);
    }
    expect(placeScan(visibleTabs(me("packer")))).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
  });

  test("company modules still hide tabs inside a set (an office plant without the orders module has no Orders tab)", () => {
    expect(visibleTabs(me("office", ["dispatches", "bundles"]))).toEqual(["today", "dispatch", "scan", "menu"]);
    expect(visibleTabs(me("die_room", ["dies"]))).toEqual(["today", "dies", "scan", "menu"]);
    expect(visibleTabs(me("die_room", ["bundles"]))).toEqual(["today", "scan", "menu"]);
  });

  test("the office Orders tab needs order.manage (the matrix), the die room tabs do not need a permission", () => {
    expect(TAB_ROUTES.find((t) => t.name === "orders")?.requires).toEqual(["order.manage"]);
    expect(TAB_ROUTES.find((t) => t.name === "dies")?.requires).toBeUndefined();
  });

  test("More is a tab entry that opens the More stack: it is a screen file, not a stack", () => {
    const menu = TAB_ROUTES.find((t) => t.name === "menu");
    expect(menu?.stack).toBe(false);
    expect(menu?.labelKey).toBe("nav.more");
  });

  test("signed out or no company is Today only, whatever the set", () => {
    expect(visibleTabs(null)).toEqual(["today"]);
  });
});

describe("Orders and Dies from More for the packer-set roles", () => {
  const rows = (role: NonNullable<Me["company"]>["role"], modules: string[] = []) => moreRows(me(role, modules)).map((r) => `${r.key}:${r.href}`);

  test("owner holds every action: Orders and the die room's Dies join More, the bar stays the packer set", () => {
    expect(extraTabs(me("owner"))).toEqual(["dies", "orders", "press", "cast"]);
    expect(reachableTabs(me("owner"))).toEqual(["today", "pack", "scan", "stock", "dispatch", "dies", "press", "cast", "orders"]);
    expect(visibleTabs(me("owner"))).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
    expect(rows("owner")).toEqual(["press:/press", "cast:/cast", "dieRoom:/dies", "orders:/orders", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("manager (masters.publish, order.manage, order.plan) gets the die board (read-only card) and Orders (m-4)", () => {
    expect(extraTabs(me("manager"))).toEqual(["dies", "orders", "press"]);
    expect(rows("manager")).toEqual(["press:/press", "dieRoom:/dies", "orders:/orders", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("admin (masters.publish, no order.manage) reaches the die board from More, but not Orders: the web hides Orders from admin too (m-4)", () => {
    expect(extraTabs(me("admin"))).toEqual(["dies", "press"]);
    expect(rows("admin")).toEqual(["press:/press", "dieRoom:/dies", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("a masters-publish role has no write action on the die card (it is read-only there)", () => {
    expect(can(me("admin"), "die.card")).toBe(false);
    expect(can(me("admin"), "die.reading")).toBe(false);
    expect(can(me("admin"), "die.issue")).toBe(false);
  });

  test("supervisor holds die.reading and press.run: Press and the Dies row that opens the die room screens join More; the press role has both on its bar", () => {
    expect(extraTabs(me("supervisor"))).toEqual(["dies", "press", "cast"]);
    expect(rows("supervisor").slice(0, 3)).toEqual(["press:/press", "cast:/cast", "dieRoom:/dies"]);
    expect(extraTabs(me("press"))).toEqual([]);
    expect(rows("press")).not.toContain("dieRoom:/dies");
  });

  test("a packer or viewer holds none of them: More is unchanged", () => {
    expect(extraTabs(me("packer"))).toEqual([]);
    expect(extraTabs(me("viewer"))).toEqual([]);
    expect(rows("packer")[0]).toBe("dies:/more/dies");
  });

  test("the die room and the office already have those tabs on the bar: no duplicate More rows", () => {
    expect(extraTabs(me("die_room"))).toEqual([]);
    expect(extraTabs(me("office"))).toEqual([]);
    expect(rows("office")).not.toContain("orders:/orders");
    expect(rows("die_room")).not.toContain("dieRoom:/dies");
  });

  test("m-1: the die room sees one Dies entry (the tab), not a second 'Dies' row for the read-only list", () => {
    expect(placeScan(visibleTabs(me("die_room")))).toContain("dies");
    expect(rows("die_room")).toEqual(["customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
    expect(moreRows(me("die_room")).some((r) => r.labelKey === "nav.dies")).toBe(false);
  });

  test("a die_room plant on the bundles module only has no Dies tab, so More keeps the read-only list Pack needs", () => {
    expect(rows("die_room", ["bundles"])[0]).toBe("dies:/more/dies");
  });

  test("m-2: a packer's reachable tabs have no Dies, so a scanned die label is only a bundle lookup for them", () => {
    expect(reachableTabs(me("packer")).includes("dies")).toBe(false);
    expect(reachableTabs(me("die_room")).includes("dies")).toBe(true);
    expect(reachableTabs(me("supervisor")).includes("dies")).toBe(true);
    const scan = readFileSync(join(import.meta.dir, "..", "features/scan/scan-view.tsx"), "utf8");
    expect(scan).toMatch(/reachableTabs\(me\)\.includes\("dies"\)/);
    expect(scan).toMatch(/diesRef\.current && \(await openDieCopy/);
  });

  test("company modules still apply: no orders module, no Orders row; no dies module, no die room row", () => {
    expect(extraTabs(me("owner", ["bundles", "dispatches"]))).toEqual([]);
    expect(extraTabs(me("owner", ["orders"]))).toEqual(["orders"]);
    expect(extraTabs(me("owner", ["dies"]))).toEqual(["dies"]);
    expect(extraTabs(me("owner", ["press"]))).toEqual(["press"]);
  });

  test("the extra tabs are routes (reachable) while the bar stays as it was; signed out has none", () => {
    expect(extraTabs(null)).toEqual([]);
    expect(reachableTabs(null)).toEqual(["today"]);
  });
});
