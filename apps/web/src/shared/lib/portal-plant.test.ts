import { describe, expect, test } from "bun:test";

import { isPartyProcedure, pickPortalPlant, portalAccessUnreachable } from "./portal-plant";

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
  test("the stored plant wins while the party still has a login there, else the first", () => {
    const plants = [{ companyId: "a" }, { companyId: "b" }];
    expect(pickPortalPlant(plants, "b")?.companyId).toBe("b");
    expect(pickPortalPlant(plants, "gone")?.companyId).toBe("a");
    expect(pickPortalPlant(plants, null)?.companyId).toBe("a");
    expect(pickPortalPlant([], "a")).toBeNull();
  });
  test("a network or server failure of portal.access is 'try again', a real refusal is 'no plants'", () => {
    expect(portalAccessUnreachable(new TypeError("Failed to fetch"))).toBe(true);
    expect(portalAccessUnreachable({ message: "boom", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } })).toBe(true);
    expect(portalAccessUnreachable({ message: "x", data: { code: "BAD_GATEWAY", httpStatus: 502 } })).toBe(true);
    expect(portalAccessUnreachable({ message: "Authentication required", data: { code: "UNAUTHORIZED", httpStatus: 401 } })).toBe(false);
    expect(portalAccessUnreachable({ message: "x", data: { code: "FORBIDDEN", httpStatus: 403 } })).toBe(false);
  });
});
