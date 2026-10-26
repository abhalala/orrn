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
