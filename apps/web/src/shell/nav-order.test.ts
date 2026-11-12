import { describe, expect, test } from "bun:test";

import type { CompanyRole, Me } from "@orrn/server/lib/permissions";

import { TENANT_MORE, TENANT_PRIMARY, visibleItems, type NavItem } from "./nav-items";
import {
  canArrangeMenu,
  NAV_MORE_ROW,
  moveNavRow,
  moveNavRowBy,
  navGroupsFromRows,
  navOrderFromRows,
  navRowsFromGroups,
  orderedNavItems,
} from "./nav-order";

const me = {
  user: { id: "u1", name: "Owner", email: "owner@test.orrn" },
  company: { id: "c1", name: "Plant", slug: "plant", status: "active", plan: null, role: "owner", modules: [] },
  isPlatformAdmin: false,
  platformRole: null,
} as Me;

const primary = visibleItems(TENANT_PRIMARY, me);
const more = visibleItems(TENANT_MORE, me);
const keys = (items: readonly NavItem[]) => items.map((item) => item.key);

function order(saved: Parameters<typeof orderedNavItems>[0]["saved"], visiblePrimary = primary, visibleMore = more) {
  return orderedNavItems({
    defaultPrimary: TENANT_PRIMARY,
    defaultMore: TENANT_MORE,
    visiblePrimary,
    visibleMore,
    saved,
  });
}

describe("orderedNavItems", () => {
  test("no saved order returns exactly today's visible groups", () => {
    const result = order(null);
    expect(keys(result.primary)).toEqual(keys(primary));
    expect(keys(result.more)).toEqual(keys(more));
    expect(order(undefined)).toEqual(result);
    expect(order({ order: [] })).toEqual(result);
  });

  test("saved visible keys come first in saved order within their default groups", () => {
    const result = order({ order: ["guides", "stock", "today"] });
    expect(keys(result.primary)).toEqual(["stock", "today", "pack", "dispatch"]);
    expect(keys(result.more).slice(0, 2)).toEqual(["guides", "orders"]);
  });

  test("items absent from the saved order follow in default order", () => {
    const result = order({ order: ["today"] });
    expect(keys(result.primary)).toEqual(["today", "pack", "stock", "dispatch"]);
    expect(keys(result.more)).toEqual(keys(TENANT_MORE));
  });

  test("items newly visible to the person follow saved items in default order", () => {
    const visibleMore = [TENANT_MORE.find((item) => item.key === "guides")!, TENANT_MORE.find((item) => item.key === "settings")!];
    const result = order({ order: ["settings"] }, primary, visibleMore);
    expect(keys(result.more)).toEqual(["settings", "guides"]);
  });

  test("unknown and repeated saved keys are ignored", () => {
    const result = order({ order: ["not-a-page", "today", "today", "stock"] });
    expect(keys(result.primary)).toEqual(["today", "stock", "pack", "dispatch"]);
    expect(keys(result.primary)).not.toContain("not-a-page");
  });

  test("moreFrom moves the divider so an item can cross it", () => {
    const result = order({ order: ["orders", "today", "stock", "guides"], moreFrom: "today" });
    expect(keys(result.primary)).toEqual(["orders"]);
    expect(keys(result.more).slice(0, 4)).toEqual(["today", "stock", "guides", "pack"]);
  });

  test("a null divider leaves More empty", () => {
    const result = order({ order: ["orders", "today"], moreFrom: null });
    expect(keys(result.primary).slice(0, 2)).toEqual(["orders", "today"]);
    expect(result.primary).toHaveLength(primary.length + more.length);
    expect(result.more).toEqual([]);
  });

  test("an unknown divider falls back to default group membership", () => {
    const result = order({ order: ["orders", "today"], moreFrom: "not-a-page" });
    expect(keys(result.primary)).toEqual(["today", "pack", "stock", "dispatch"]);
    expect(keys(result.more)[0]).toBe("orders");
  });

  test("a hidden divider uses the next visible saved key", () => {
    const visiblePrimary = TENANT_PRIMARY.filter((item) => item.key !== "pack");
    const visibleMore = TENANT_MORE.filter((item) => ["orders", "guides"].includes(item.key));
    const result = order({ order: ["orders", "pack", "today", "guides"], moreFrom: "pack" }, visiblePrimary, visibleMore);
    expect(keys(result.primary)).toEqual(["orders"]);
    expect(keys(result.more)[0]).toBe("today");
  });

  test("every role keeps exactly its visibleItems groups with no saved order", () => {
    const roles: CompanyRole[] = ["owner", "admin", "manager", "office", "accountant", "supervisor", "packer", "foundry", "press", "storekeeper", "die_room", "operator", "viewer"];
    for (const role of roles) {
      const person = { ...me, company: { ...me.company!, role } } as Me;
      const visiblePrimary = visibleItems(TENANT_PRIMARY, person);
      const visibleMore = visibleItems(TENANT_MORE, person);
      const result = order(null, visiblePrimary, visibleMore);
      expect({ role, primary: keys(result.primary), more: keys(result.more) }).toEqual({
        role,
        primary: keys(visiblePrimary),
        more: keys(visibleMore),
      });
    }
  });

  test("impersonating staff cannot arrange a member's menu", () => {
    expect(canArrangeMenu(me)).toBe(true);
    const impersonating = {
      ...me,
      impersonation: { actorUserId: "staff", companyId: "c1", grantId: "g1", expiresAt: new Date(0).toISOString() },
    } as Me;
    expect(canArrangeMenu(impersonating)).toBe(false);
    expect(canArrangeMenu({ ...me, company: null })).toBe(false);
  });
});

describe("nav editor rows", () => {
  const groups = {
    primary: [TENANT_PRIMARY[0]!, TENANT_PRIMARY[1]!],
    more: [TENANT_MORE[0]!, TENANT_MORE.find((item) => item.key === "guides")!],
  };

  test("one divider serializes as one order plus the first More key", () => {
    const rows = navRowsFromGroups(groups);
    expect(rows.map((row) => row.id)).toEqual(["today", "pack", NAV_MORE_ROW, "orders", "guides"]);
    expect(navOrderFromRows(rows)).toEqual({ order: ["today", "pack", "orders", "guides"], moreFrom: "orders" });
    expect(navGroupsFromRows(rows)).toEqual(groups);
  });

  test("Move up crosses the divider and Move down crosses it back", () => {
    const rows = navRowsFromGroups(groups);
    const crossed = moveNavRowBy(rows, "orders", -1);
    expect(keys(navGroupsFromRows(crossed).primary)).toEqual(["today", "pack", "orders"]);
    expect(keys(navGroupsFromRows(crossed).more)).toEqual(["guides"]);
    const back = moveNavRowBy(crossed, "orders", 1);
    expect(navGroupsFromRows(back)).toEqual(groups);
  });

  test("a drag can move an item over another item or the divider", () => {
    const rows = navRowsFromGroups(groups);
    expect(moveNavRow(rows, "guides", "today")[0]?.id).toBe("guides");
    const across = moveNavRow(rows, "orders", NAV_MORE_ROW);
    expect(keys(navGroupsFromRows(across).primary)).toEqual(["today", "pack", "orders"]);
  });
});
