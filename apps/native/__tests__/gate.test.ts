import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import type { Me } from "@orrn/server/lib/permissions";

import { noAccessReason, offlineKind, resolveGate, routeForMe } from "../lib/gate";
import { RequestTimeoutError } from "../lib/request-timeout";

function makeMe(overrides: Omit<Partial<Me>, "user"> & { user?: Partial<Me["user"]> } = {}): Me {
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
    expect(routeForMe(makeMe({ company: null, isPlatformAdmin: true, platformRole: "super_admin" }))).toBe("/no-access");
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

  test("Try again on the offline screen stays on it (TanStack puts an errored query with no data back to pending)", () => {
    // Seen on the simulator: the screen flipped to the full-screen spinner and lost its state.
    expect(resolveGate({ hasSession: true, me: undefined, error: null, isPending: true, failedFetches: 1 })).toBe("offline");
    expect(resolveGate({ hasSession: true, me: undefined, error: null, isPending: true, failedFetches: 0 })).toBe("loading");
  });

  test("data routes through routeForMe", () => {
    expect(resolveGate({ hasSession: true, me: makeMe({ company: null }), error: null, isPending: false })).toBe("/no-access");
  });
});

describe("offlineKind (which copy the offline screen shows)", () => {
  test("no answer at all is the network", () => {
    expect(offlineKind({ message: "Network request failed", data: null })).toBe("network");
    expect(offlineKind(Object.assign(new Error("Request timed out"), { cause: new RequestTimeoutError(10_000) }))).toBe("network");
    expect(offlineKind(undefined)).toBe("network");
  });

  test("a 5xx from orrn is orrn's problem, not the phone's connection", () => {
    expect(offlineKind({ message: "boom", data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 } })).toBe("server");
    expect(offlineKind({ message: "bad gateway", data: null, meta: { response: { status: 502 } } })).toBe("server");
  });
});

describe("offline screen", () => {
  const layout = readFileSync(join(import.meta.dir, "..", "app/_layout.tsx"), "utf8");

  test("its copy follows the failure (network vs orrn)", () => {
    expect(layout).toMatch(/offlineKind\(me\.error \?\? lastError\)/);
    expect(layout).toMatch(/native\.serverTitle/);
  });

  test("after a failed retry it offers a way out to another account (a shared phone is never stuck)", () => {
    // errorUpdateCount survives the screen re-rendering; a component counter did not.
    expect(layout).toMatch(/failedFetches: me\.errorUpdateCount/);
    expect(layout).toMatch(/failedFetches > 1/);
    expect(layout).toMatch(/auth\.noAccess\.switchAccount/);
    expect(layout).toMatch(/signOut\(\)/);
  });
});

describe("set-password copy (ruling T28-1: the person may own only a phone)", () => {
  test("points to orrn.in in the phone's browser, not only to a computer", () => {
    expect(en.native.setPasswordBody).toContain("orrn.in");
    expect(en.native.setPasswordBody).toMatch(/phone's browser/);
    expect(hi.native.setPasswordBody).toContain("orrn.in");
    expect(hi.native.setPasswordBody).toContain("ब्राउज़र");
  });
});
