import { describe, expect, test } from "bun:test";

import type { CompanyRole, Me } from "@orrn/server/lib/permissions";

import { bundleDetailPath } from "../shared/lib/paths";

import { GODSEYE_NAV, TENANT_MORE, TENANT_PRIMARY, isItemActive, visibleItems, type NavItem } from "./nav-items";

function me(role: CompanyRole, modules?: string[]): Me {
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
      "masters",
      "guides",
      "settings",
      "preview",
    ]);
  });

  test("viewer has no Pack and no Settings but keeps Stock and Printing", () => {
    const visible = keys(visibleItems(ALL, me("viewer")));
    expect(visible).not.toContain("pack");
    expect(visible).not.toContain("settings");
    expect(visible).toContain("stock");
    expect(visible).toContain("printing");
  });

  test("operator packs but doesn't see Settings (R24)", () => {
    expect(keys(visibleItems(TENANT_PRIMARY, me("operator")))).toContain("pack");
    expect(keys(visibleItems(TENANT_MORE, me("operator")))).toEqual(["dies", "customers", "printing", "guides", "preview"]);
  });

  test("modules filter (case-insensitive); empty list means all on", () => {
    const visible = keys(visibleItems(ALL, me("owner", ["Customers"])));
    expect(visible).toEqual(["today", "customers", "printing", "masters", "guides", "settings", "preview"]);
    expect(keys(visibleItems(ALL, me("owner", [])))).toHaveLength(ALL.length);
  });

  test("Masters for the people who publish or draft masters (PL-W1)", () => {
    const more = (role: CompanyRole) => keys(visibleItems(TENANT_MORE, me(role)));
    for (const role of ["owner", "admin", "manager", "office"] as const) {
      expect({ role, masters: more(role).includes("masters") }).toEqual({ role, masters: true });
    }
    for (const role of ["operator", "viewer", "storekeeper", "packer", "die_room", "accountant"] as const) {
      expect({ role, masters: more(role).includes("masters") }).toEqual({ role, masters: false });
    }
  });

  test("Godseye items follow the platform role", () => {
    const support = { ...me("owner"), company: null, isPlatformAdmin: true, platformRole: "support" } as Me;
    expect(keys(visibleItems(GODSEYE_NAV, support))).toEqual(["overview", "companies", "requests", "staff"]);
    expect(keys(visibleItems(GODSEYE_NAV, me("owner")))).toEqual(["overview"]);
  });
});

describe("isItemActive", () => {
  const byKey = (k: string) => ALL.find((i) => i.key === k)!;

  test("matches the item's path and everything under it", () => {
    expect(isItemActive(byKey("today"), "/today")).toBe(true);
    expect(isItemActive(byKey("dispatch"), "/dispatch/abc")).toBe(true);
    expect(isItemActive(byKey("stock"), "/stock/bundles")).toBe(true);
    expect(isItemActive(byKey("pack"), "/pack/new")).toBe(true);
    expect(isItemActive(byKey("settings"), "/settings")).toBe(true);
    expect(isItemActive(byKey("masters"), "/masters/scrap")).toBe(true);
  });

  test("vendor pages belong to Masters", () => {
    expect(isItemActive(byKey("masters"), "/vendors")).toBe(true);
    expect(isItemActive(byKey("masters"), "/vendors/abc")).toBe(true);
    expect(isItemActive(byKey("masters"), "/vendorsx")).toBe(false);
  });

  test("a bundle page belongs to Stock", () => {
    expect(isItemActive(byKey("stock"), "/b/26I4086")).toBe(true);
    expect(isItemActive(byKey("pack"), "/b/26I4086")).toBe(false);
  });

  test("does not confuse siblings with a shared prefix", () => {
    expect(isItemActive(byKey("dispatch"), "/dies")).toBe(false);
    expect(isItemActive(byKey("dispatch"), "/dispatches/abc")).toBe(false);
    expect(isItemActive(byKey("stock"), "/bundles/abc")).toBe(false);
    expect(isItemActive(byKey("stock"), "/bx")).toBe(false);
  });

  test("Godseye overview is exact", () => {
    const overview = GODSEYE_NAV[0]!;
    expect(isItemActive(overview, "/admin")).toBe(true);
    expect(isItemActive(overview, "/admin/companies")).toBe(false);
  });
});

describe("bundleDetailPath", () => {
  test("is the label QR path, serial encoded", () => {
    expect(bundleDetailPath({ serial: "26I4086" })).toBe("/b/26I4086");
    expect(bundleDetailPath({ serial: "BG-000001-B001" })).toBe("/b/BG-000001-B001");
    expect(bundleDetailPath({ serial: "a b/c" })).toBe("/b/a%20b%2Fc");
  });
});
