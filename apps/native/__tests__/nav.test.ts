import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

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
    expect(TAB_ROUTES.map((t) => t.name)).toEqual(["today", "pack", "scan", "stock", "dispatch", "dies", "press", "orders", "menu"]);
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

  test("every other role keeps the packer set, including owner, manager, supervisor and packer", () => {
    for (const role of ["owner", "admin", "manager", "supervisor", "packer", "viewer", "operator", "accountant", "foundry", "press", "storekeeper"] as const) {
      expect(tabSetFor(me(role))).toBe("floor");
      expect(visibleTabs(me(role)).every((t) => TAB_SETS.floor.includes(t))).toBe(true);
    }
    expect(placeScan(visibleTabs(me("packer")))).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
  });

  test("company modules still hide tabs inside a set (an office plant without the orders module has no Orders tab)", () => {
    expect(visibleTabs(me("office", ["dispatches", "bundles"]))).toEqual(["today", "scan", "dispatch", "menu"]);
    expect(visibleTabs(me("die_room", ["dies"]))).toEqual(["today", "scan", "dies", "menu"]);
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
    expect(extraTabs(me("owner"))).toEqual(["dies", "orders"]);
    expect(reachableTabs(me("owner"))).toEqual(["today", "pack", "scan", "stock", "dispatch", "dies", "orders"]);
    expect(visibleTabs(me("owner"))).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
    expect(rows("owner")).toEqual(["dieRoom:/dies", "orders:/orders", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("manager (order.manage, order.plan) gets Orders and keeps the read-only die list (no die.card or die.reading)", () => {
    expect(extraTabs(me("manager"))).toEqual(["orders"]);
    expect(rows("manager")).toEqual(["dies:/more/dies", "orders:/orders", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("admin holds neither order.manage nor die.card in the matrix: no extra rows", () => {
    expect(extraTabs(me("admin"))).toEqual([]);
    expect(rows("admin")).toEqual(["dies:/more/dies", "customers:/more/customers", "guides:/more/guides", "settings:/more/settings"]);
  });

  test("press and supervisor hold die.reading: the Dies row opens the die room screens", () => {
    expect(extraTabs(me("press"))).toEqual(["dies"]);
    expect(extraTabs(me("supervisor"))).toEqual(["dies"]);
    expect(rows("supervisor")[0]).toBe("dieRoom:/dies");
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

  test("company modules still apply: no orders module, no Orders row; no dies module, no die room row", () => {
    expect(extraTabs(me("owner", ["bundles", "dispatches"]))).toEqual([]);
    expect(extraTabs(me("owner", ["orders"]))).toEqual(["orders"]);
    expect(extraTabs(me("owner", ["dies"]))).toEqual(["dies"]);
  });

  test("the extra tabs are routes (reachable) while the bar stays as it was; signed out has none", () => {
    expect(extraTabs(null)).toEqual([]);
    expect(reachableTabs(null)).toEqual(["today"]);
  });
});
