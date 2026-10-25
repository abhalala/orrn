import { describe, expect, test } from "bun:test";

import { isPartyProcedure, isPartyRequest, pickPortalPlant } from "./portal-plant";

describe("x-orrn-company for the portal", () => {
  test("only party procedures carry the header", () => {
    for (const name of ["portal.me", "portal.today", "portal.sections.visible", "portal.orders.list", "portal.orders.create", "portal.dispatches.get", "portal.packingList.get", "portal.certificate.get"]) {
      expect(isPartyProcedure(name)).toBe(true);
    }
    // Plant-side procedures share the namespace and must never get a party plant header.
    for (const name of ["portal.users.list", "portal.users.grant", "portal.sections.list", "portal.sections.grant", "portal.certificates.issue", "portal.certificates.forDispatch", "auth.me", "portal.access"]) {
      expect(isPartyProcedure(name)).toBe(false);
    }
  });
  test("a batched URL gets the header only when every procedure is a party procedure", () => {
    expect(isPartyRequest("http://x/trpc/portal.me,portal.today?batch=1&input=%7B%7D")).toBe(true);
    expect(isPartyRequest("http://x/trpc/portal.me,auth.me?batch=1")).toBe(false);
    expect(isPartyRequest("http://x/trpc/portal.users.list?batch=1")).toBe(false);
    expect(isPartyRequest("http://x/api/auth/get-session")).toBe(false);
  });
  test("the stored plant wins while the party still has a login there, else the first", () => {
    const plants = [{ companyId: "a" }, { companyId: "b" }];
    expect(pickPortalPlant(plants, "b")?.companyId).toBe("b");
    expect(pickPortalPlant(plants, "gone")?.companyId).toBe("a");
    expect(pickPortalPlant(plants, null)?.companyId).toBe("a");
    expect(pickPortalPlant([], "a")).toBeNull();
  });
});
