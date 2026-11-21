import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";
import { hi } from "@orrn/i18n/hi";
import type { Me } from "@orrn/server/lib/permissions";

import { noAccessReason, offlineKind, phoneSetupPending, resolveGate, routeForMe } from "../lib/gate";
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

describe("plants on the phone (plan 2026-11-18, Task 9)", () => {
  const two = {
    memberships: [
      { companyId: "c1", name: "Fourcubes", role: "packer" as const, setupPending: false },
      { companyId: "c2", name: "Ravi Aluminium", role: "owner" as const, setupPending: true },
    ],
  };
  const plant = (company: Partial<NonNullable<Me["company"]>>) => ({
    company: { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role: "packer" as const, ...company },
  });

  test("a sign-in of a person in several plants opens the picker; a cold start does not", () => {
    expect(routeForMe(makeMe(two), true)).toBe("/choose-plant");
    expect(routeForMe(makeMe(two), false)).toBe("/(tabs)/today");
    expect(routeForMe(makeMe(two))).toBe("/(tabs)/today");
    expect(resolveGate({ hasSession: true, me: makeMe(two), error: null, isPending: false, plantChoicePending: true })).toBe("/choose-plant");
  });

  test("the picker shows Setup pending only where an owner or admin owes the setup (floor roles never)", () => {
    expect(phoneSetupPending({ role: "owner", setupPending: true })).toBe(true);
    expect(phoneSetupPending({ role: "admin", setupPending: true })).toBe(true);
    for (const role of ["packer", "operator", "supervisor", "dispatcher", "viewer"]) {
      expect(phoneSetupPending({ role, setupPending: true })).toBe(false);
    }
    expect(phoneSetupPending({ role: "owner", setupPending: false })).toBe(false);
    expect(phoneSetupPending({ role: "owner" })).toBe(false);
  });

  test("the native picker screen uses the floor-role rule for its chip", () => {
    const src = readFileSync(join(import.meta.dir, "../app/choose-plant.tsx"), "utf8");
    expect(src).toContain("phoneSetupPending(plant)");
    expect(src).not.toContain("plant.setupPending === true");
  });

  test("one plant never opens the picker; a temp password comes first", () => {
    expect(routeForMe(makeMe({ memberships: [two.memberships[0]!] }), true)).toBe("/(tabs)/today");
    expect(routeForMe(makeMe({ ...two, user: { mustChangePassword: true } }), true)).toBe("/no-access");
  });

  test("a plant that requires secure sign-in, without a strong method: finish on the web (any role)", () => {
    for (const role of ["packer", "operator", "owner"] as const) {
      const me = makeMe(plant({ role, requireStrongSignIn: true, setupPending: false }));
      expect(routeForMe(me)).toBe("/no-access");
      expect(noAccessReason(me)).toBe("secure-on-web");
    }
    expect(routeForMe(makeMe({ ...plant({ requireStrongSignIn: true }), user: { hasPasskey: true } }))).toBe("/(tabs)/today");
    expect(routeForMe(makeMe({ ...plant({ requireStrongSignIn: true }), user: { twoFactorEnabled: true } }))).toBe("/(tabs)/today");
  });

  test("an owner's or admin's open plant setup: finish on the web; a floor role's never blocks (T28-1)", () => {
    for (const role of ["owner", "admin"] as const) {
      const me = makeMe(plant({ role, setupPending: true }));
      expect(routeForMe(me)).toBe("/no-access");
      expect(noAccessReason(me)).toBe("finish-on-web");
    }
    for (const role of ["packer", "operator", "manager", "viewer"] as const) {
      expect(routeForMe(makeMe(plant({ role, setupPending: true })))).toBe("/(tabs)/today");
    }
    // An older auth.me without setupPending: the floor app opens as before.
    expect(routeForMe(makeMe(plant({ role: "owner" })))).toBe("/(tabs)/today");
  });

  test("the plant choice store", async () => {
    const { plantChoice } = await import("../lib/plant-choice");
    let calls = 0;
    const off = plantChoice.subscribe(() => calls++);
    plantChoice.set(true);
    expect(plantChoice.get()).toBe(true);
    plantChoice.set(true);
    plantChoice.set(false);
    expect(plantChoice.get()).toBe(false);
    expect(calls).toBe(2);
    off();
  });

  test("the finish-on-the-web copy points to orrn.in in the phone's browser and names the plant", () => {
    for (const key of ["finishOnWebBody", "secureOnWebBody"] as const) {
      expect(en.native[key]).toContain("orrn.in");
      expect(en.native[key]).toContain("{company}");
      expect(hi.native[key]).toContain("orrn.in");
    }
  });
});
