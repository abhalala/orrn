import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { GODSEYE_NAV, TENANT_MORE, TENANT_PRIMARY, isItemActive, visibleItems, type NavItem } from "./nav-items";
import { bundleDetailPath, navTarget } from "./route-compat";

function me(role: "owner" | "operator" | "viewer", modules?: string[]): Me {
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local" },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
    platformRole: null,
  } as Me;
}

const keys = (items: NavItem[]) => items.map((i) => i.key);
const ALL = [...TENANT_PRIMARY, ...TENANT_MORE];

describe("visibleItems", () => {
  test("owner with no modules set sees everything", () => {
    expect(keys(visibleItems(ALL, me("owner")))).toEqual([
      "today",
      "pack",
      "stock",
      "dispatch",
      "dies",
      "customers",
      "printing",
      "guides",
      "settings",
    ]);
  });

  test("viewer has no Pack but keeps Stock and Printing", () => {
    const visible = keys(visibleItems(ALL, me("viewer")));
    expect(visible).not.toContain("pack");
    expect(visible).toContain("stock");
    expect(visible).toContain("printing");
  });

  test("operator packs", () => {
    expect(keys(visibleItems(TENANT_PRIMARY, me("operator")))).toContain("pack");
  });

  test("modules filter (case-insensitive); empty list means all on", () => {
    const visible = keys(visibleItems(ALL, me("owner", ["Customers"])));
    expect(visible).toEqual(["today", "customers", "printing", "guides", "settings"]);
    expect(keys(visibleItems(ALL, me("owner", [])))).toHaveLength(ALL.length);
  });

  test("Godseye items follow the platform role", () => {
    const support = { ...me("owner"), company: null, isPlatformAdmin: true, platformRole: "support" } as Me;
    expect(keys(visibleItems(GODSEYE_NAV, support))).toEqual(["overview", "companies", "requests", "staff"]);
    expect(keys(visibleItems(GODSEYE_NAV, me("owner")))).toEqual(["overview"]);
  });
});

describe("isItemActive", () => {
  const byKey = (k: string) => ALL.find((i) => i.key === k)!;

  test("matches the C2 path, today's route and old URLs", () => {
    expect(isItemActive(byKey("today"), "/dashboard")).toBe(true);
    expect(isItemActive(byKey("today"), "/today")).toBe(true);
    expect(isItemActive(byKey("dispatch"), "/dispatches/abc")).toBe(true);
    expect(isItemActive(byKey("dispatch"), "/packing-lists/abc")).toBe(true);
    expect(isItemActive(byKey("stock"), "/bundles/abc")).toBe(true);
    expect(isItemActive(byKey("pack"), "/receipts/new")).toBe(true);
    expect(isItemActive(byKey("settings"), "/settings/members")).toBe(true);
  });

  test("does not confuse siblings with a shared prefix", () => {
    expect(isItemActive(byKey("dispatch"), "/dies")).toBe(false);
    expect(isItemActive(byKey("pack"), "/packing-lists/x")).toBe(false);
  });

  test("Godseye overview is exact", () => {
    const overview = GODSEYE_NAV[0]!;
    expect(isItemActive(overview, "/admin")).toBe(true);
    expect(isItemActive(overview, "/admin/companies")).toBe(false);
  });
});

describe("navTarget", () => {
  test("maps C2 paths to today's routes on a segment boundary", () => {
    expect(navTarget("/today")).toBe("/dashboard");
    expect(navTarget("/pack/new")).toBe("/receipts/new");
    expect(navTarget("/dispatch/abc")).toBe("/dispatches/abc");
    expect(navTarget("/stock")).toBe("/stock");
    expect(navTarget("/stock/bundles")).toBe("/bundles");
    expect(navTarget("/printing")).toBe("/spool");
    expect(navTarget("/settings")).toBe("/settings/members");
    expect(navTarget("/admin/requests")).toBe("/admin/waitlist");
    expect(navTarget("/dies")).toBe("/dies");
    expect(navTarget("/guides")).toBe("/guides");
  });

  test("bundle detail uses the id route for now", () => {
    expect(bundleDetailPath({ id: "b 1", serial: "BG-1" })).toBe("/bundles/b%201");
  });
});
