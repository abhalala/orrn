import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n/en";

import type { Me } from "@/shared/lib/me";

import { finishesOnboardingHere } from "./finishes-onboarding";

function me(role: NonNullable<Me["company"]>["role"] | null, onboardingCompleted: boolean): Me {
  return {
    user: { id: "u1", name: "Ramesh Patel", email: "ramesh@fourcubes.in", onboardingCompleted },
    company: role ? { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role } : null,
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
  } as Me;
}

describe("finishesOnboardingHere: the closing screen's 'Go to Today' closes onboarding", () => {
  const roles = Object.keys(en.roles) as NonNullable<Me["company"]>["role"][];

  test("for every role without company settings rights while onboarding is open", () => {
    expect(roles.length).toBeGreaterThanOrEqual(13);
    for (const role of roles) {
      // Owners and admins already finished it in the company step.
      const expected = role !== "owner" && role !== "admin";
      expect({ role, finishes: finishesOnboardingHere(me(role, false)) }).toEqual({ role, finishes: expected });
    }
  });

  test("never once onboarding is done", () => {
    for (const role of roles) expect(finishesOnboardingHere(me(role, true))).toBe(false);
  });

  test("a temp-password staff member with the flag open (no company) finishes it too", () => {
    expect(finishesOnboardingHere(me(null, false))).toBe(true);
  });
});

describe("per-plant onboarding (plan 2026-11-18, Task 9)", () => {
  const withPlant = (role: NonNullable<Me["company"]>["role"], setupPending: boolean, onboardingCompleted: boolean): Me => {
    const base = me(role, onboardingCompleted);
    return { ...base, company: { ...base.company!, setupPending } };
  };

  test("the active plant's setup decides, not the user flag", () => {
    // Set up in another plant (flag on), new here: the closing screen marks this plant.
    expect(finishesOnboardingHere(withPlant("packer", true, true))).toBe(true);
    // This plant done, the old flag still off: nothing to close.
    expect(finishesOnboardingHere(withPlant("packer", false, false))).toBe(false);
  });

  test("never while impersonating", () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(finishesOnboardingHere({ ...withPlant("viewer", true, false), impersonation: grant })).toBe(false);
  });
});
