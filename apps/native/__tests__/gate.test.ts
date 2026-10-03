import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { noAccessReason, resolveGate, routeForMe } from "../lib/gate";

function makeMe(overrides: Partial<Me> & { user?: Partial<Me["user"]> } = {}): Me {
  const { user, ...rest } = overrides;
  return {
    user: { id: "u1", name: "Ravi", email: "ravi@plant.in", onboardingCompleted: true, mustChangePassword: false, ...user },
    company: {
      id: "c1",
      name: "Fourcubes",
      slug: "fourcubes",
      status: "active",
      plan: null,
      role: "packer",
    },
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    ...rest,
  };
}

describe("routeForMe", () => {
  test("signed out goes to sign-in", () => {
    expect(routeForMe(null)).toBe("/(auth)/sign-in");
    expect(routeForMe(undefined)).toBe("/(auth)/sign-in");
  });

  test("a member of a company lands on Today", () => {
    expect(routeForMe(makeMe())).toBe("/(tabs)/today");
  });

  test("no company means no access", () => {
    expect(routeForMe(makeMe({ company: null }))).toBe("/no-access");
  });

  test("platform staff without a company also get no access (Godseye is web only)", () => {
    expect(routeForMe(makeMe({ company: null, isPlatformAdmin: true, platformRole: "superadmin" }))).toBe("/no-access");
  });

  test("a temporary password must be replaced before using the app", () => {
    expect(routeForMe(makeMe({ user: { mustChangePassword: true } }))).toBe("/no-access");
  });

  test("unfinished web onboarding does not block the floor app", () => {
    expect(routeForMe(makeMe({ user: { onboardingCompleted: false } }))).toBe("/(tabs)/today");
  });
});

describe("noAccessReason", () => {
  test("names why the person is on the no-access screen", () => {
    expect(noAccessReason(makeMe({ company: null }))).toBe("no-company");
    expect(noAccessReason(makeMe({ company: null, isPlatformAdmin: true, platformRole: "support" }))).toBe("staff");
    expect(noAccessReason(makeMe({ user: { mustChangePassword: true } }))).toBe("set-password");
    expect(noAccessReason(makeMe())).toBeNull();
    expect(noAccessReason(null)).toBeNull();
  });
});

describe("resolveGate", () => {
  const unauthorized = { message: "UNAUTHORIZED", data: { code: "UNAUTHORIZED", httpStatus: 401 } };
  const serverDown = { message: "fetch failed", data: null };

  test("no stored session goes straight to sign-in, even offline", () => {
    expect(resolveGate({ hasSession: false, me: undefined, error: serverDown, isPending: false })).toBe("/(auth)/sign-in");
    expect(resolveGate({ hasSession: false, me: undefined, error: null, isPending: true })).toBe("/(auth)/sign-in");
  });

  test("waits while the first auth.me is in flight", () => {
    expect(resolveGate({ hasSession: true, me: undefined, error: null, isPending: true })).toBe("loading");
  });

  test("UNAUTHORIZED wins over stale cached data (session expired mid-use)", () => {
    expect(resolveGate({ hasSession: true, me: makeMe(), error: unauthorized, isPending: false })).toBe("/(auth)/sign-in");
  });

  test("a network blip keeps a signed-in person where they are", () => {
    expect(resolveGate({ hasSession: true, me: makeMe(), error: serverDown, isPending: false })).toBe("/(tabs)/today");
  });

  test("no data and a non-auth failure shows the offline screen, not sign-in", () => {
    expect(resolveGate({ hasSession: true, me: undefined, error: serverDown, isPending: false })).toBe("offline");
  });

  test("data routes through routeForMe", () => {
    expect(resolveGate({ hasSession: true, me: makeMe({ company: null }), error: null, isPending: false })).toBe("/no-access");
  });
});
