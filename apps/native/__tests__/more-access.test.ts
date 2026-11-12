import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { moreRouteAccess } from "../features/more/access";

function me(role: NonNullable<Me["company"]>["role"], modules: string[]): Me {
  return {
    user: { id: "u", name: "A", email: "a@b.in" },
    company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role, modules },
    isPlatformAdmin: false,
  };
}

describe("deep links to the new More screens", () => {
  test("furnaces and alloys allow only masters publishers with the foundry module", () => {
    for (const route of ["furnaces", "alloys"] as const) {
      for (const role of ["owner", "admin", "manager"] as const) expect(moreRouteAccess(me(role, ["foundry"]), route)).toBe("allowed");
      for (const role of ["foundry", "supervisor", "office", "packer", "die_room"] as const) expect(moreRouteAccess(me(role, ["foundry"]), route)).toBe("not_allowed");
      expect(moreRouteAccess(me("manager", ["bundles"]), route)).toBe("not_allowed");
    }
  });

  test("nitriding and makers allow the die room with the dies module", () => {
    for (const route of ["nitriding", "makers"] as const) {
      for (const role of ["die_room", "owner"] as const) expect(moreRouteAccess(me(role, ["dies"]), route)).toBe("allowed");
      for (const role of ["manager", "supervisor", "office", "packer", "foundry"] as const) expect(moreRouteAccess(me(role, ["dies"]), route)).toBe("not_allowed");
      expect(moreRouteAccess(me("die_room", ["bundles"]), route)).toBe("not_allowed");
    }
  });
});
