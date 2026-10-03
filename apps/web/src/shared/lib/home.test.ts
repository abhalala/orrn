import { describe, expect, test } from "bun:test";

import type { Me } from "./me";
import { homeFor, resolveHomeTarget } from "./home";

function me(over: Partial<Me> & { user?: Partial<Me["user"]> } = {}): Me {
  const { user, ...rest } = over;
  return {
    user: { id: "u1", name: "U", email: "u@orrn.local", onboardingCompleted: true, mustChangePassword: false, ...user },
    company: { id: "c1", name: "Co", slug: "co", status: "active", plan: "growth", role: "owner" },
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    ...rest,
  } as Me;
}

describe("homeFor", () => {
  test("tenant member with onboarding done lands on /today", () => {
    expect(homeFor(me())).toBe("/today");
    expect(homeFor(me({ company: { ...me().company!, role: "viewer" } }))).toBe("/today");
  });

  test("platform staff without a company land on /admin, not /no-access", () => {
    expect(homeFor(me({ company: null, isPlatformAdmin: true, platformRole: "owner" as never }))).toBe("/admin");
  });

  test("user with no company and no staff role lands on /no-access", () => {
    expect(homeFor(me({ company: null }))).toBe("/no-access");
  });

  test("outstanding steps send the user to /welcome", () => {
    expect(homeFor(me({ user: { mustChangePassword: true } }))).toBe("/welcome");
    expect(homeFor(me({ user: { onboardingCompleted: false } }))).toBe("/welcome");
    expect(
      homeFor(me({ company: null, isPlatformAdmin: true, platformRole: "owner" as never, user: { mustChangePassword: true } })),
    ).toBe("/welcome");
  });

  test("an impersonating admin lands on /today regardless of own onboarding", () => {
    expect(
      homeFor(
        me({
          isPlatformAdmin: true,
          platformRole: "owner" as never,
          user: { onboardingCompleted: false },
          impersonation: { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" },
        }),
      ),
    ).toBe("/today");
  });
});

describe("resolveHomeTarget", () => {
  test("maps /welcome onto the screens that exist today", () => {
    expect(resolveHomeTarget("/welcome", me({ user: { mustChangePassword: true } }))).toBe("/change-password");
    expect(resolveHomeTarget("/welcome", me({ user: { onboardingCompleted: false } }))).toBe("/onboarding");
  });

  test("passes other destinations through", () => {
    expect(resolveHomeTarget("/today", me())).toBe("/today");
    expect(resolveHomeTarget("/admin", me())).toBe("/admin");
    expect(resolveHomeTarget("/no-access", me())).toBe("/no-access");
  });
});
