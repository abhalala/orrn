import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { placeScan, TAB_ROUTES, visibleTabs } from "../lib/nav";

function me(role: NonNullable<Me["company"]>["role"], modules: string[] = []): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

describe("native tabs", () => {
  test("declared order is Today, Pack, Scan, Stock, Dispatch", () => {
    expect(TAB_ROUTES.map((t) => t.name)).toEqual(["today", "pack", "scan", "stock", "dispatch"]);
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
