import { describe, expect, test } from "bun:test";

import type { Me } from "@/shared/lib/me";

import { destinationAfterSignIn } from "./after-sign-in";

function me(over: Partial<Me> & { user?: Partial<Me["user"]> } = {}): Me {
  const { user, ...rest } = over;
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local", onboardingCompleted: true, mustChangePassword: false, ...user },
    company: { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role: "owner" },
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    ...rest,
  } as Me;
}

describe("destinationAfterSignIn", () => {
  test("honours a same-origin next for people whose home is the app", () => {
    expect(destinationAfterSignIn(me(), "/dispatch/abc?tab=list")).toBe("/dispatch/abc?tab=list");
    expect(destinationAfterSignIn(me(), undefined)).toBe("/today");
  });

  test("never follows an off-site next (W4)", () => {
    expect(destinationAfterSignIn(me(), "//evil.com/phish")).toBe("/today");
    expect(destinationAfterSignIn(me(), "https://evil.com")).toBe("/today");
  });

  test("staff go to the console, honouring next there too", () => {
    const staff = me({ company: null, isPlatformAdmin: true, platformRole: "support" as never });
    expect(destinationAfterSignIn(staff)).toBe("/admin");
    expect(destinationAfterSignIn(staff, "/admin/companies")).toBe("/admin/companies");
  });

  test("open welcome steps and no company win over next", () => {
    expect(destinationAfterSignIn(me({ user: { mustChangePassword: true } }), "/today")).toBe("/welcome");
    expect(destinationAfterSignIn(me({ company: null }), "/today")).toBe("/no-access");
  });

  test("when me can't be read, fall back to a safe next or Today", () => {
    expect(destinationAfterSignIn(null, "/stock")).toBe("/stock");
    expect(destinationAfterSignIn(null, "//evil.com")).toBe("/today");
  });
});
