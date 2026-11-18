import { describe, expect, test } from "bun:test";

import { mayHandOutRole } from "./invites";

describe("mayHandOutRole (invite.create, invite.resend and the Team tab share it)", () => {
  test("only an owner hands out the owner role", () => {
    expect(mayHandOutRole("owner", "owner")).toBe(true);
    for (const me of ["admin", "manager", undefined, null]) expect(mayHandOutRole(me, "owner")).toBe(false);
  });

  test("any other role is fine for whoever may invite at all (the permission check is separate)", () => {
    for (const role of ["admin", "manager", "operator", "viewer"]) {
      expect(mayHandOutRole("admin", role)).toBe(true);
      expect(mayHandOutRole("owner", role)).toBe(true);
    }
  });
});
