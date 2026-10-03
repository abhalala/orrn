import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n";
import { can } from "@orrn/server/lib/permissions";

import type { Me } from "@/shared/lib/me";

import { COMPANY_SETUP_ROLES, parseMagicFlag, welcomeSteps, welcomeTimeline } from "./welcome-steps";

type MeOver = Partial<Omit<Me, "user" | "company">> & {
  user?: Partial<Me["user"]>;
  company?: Partial<NonNullable<Me["company"]>> | null;
};

function me(over: MeOver = {}): Me {
  const { user, company, ...rest } = over;
  return {
    user: {
      id: "u1",
      name: "Ramesh Patel",
      email: "ramesh@fourcubes.in",
      onboardingCompleted: true,
      mustChangePassword: false,
      twoFactorEnabled: false,
      ...user,
    },
    company:
      company === null
        ? null
        : { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role: "owner", ...company },
    isPlatformAdmin: false,
    platformRole: null,
    impersonation: null,
    ...rest,
  } as Me;
}

describe("welcomeSteps: the four user types", () => {
  test("magic-link owner from waitlist approval: password, two-factor, company", () => {
    const owner = me({ user: { onboardingCompleted: false, twoFactorEnabled: false } });
    expect(welcomeSteps(owner, { magic: true })).toEqual(["password", "twoFactor", "company"]);
  });

  test("temp-password staff member (forced change): only the password step", () => {
    const staff = me({
      company: null,
      isPlatformAdmin: true,
      platformRole: "support",
      user: { mustChangePassword: true, onboardingCompleted: true },
    });
    expect(welcomeSteps(staff)).toEqual(["password"]);
    // A temp-password operator in a plant: still only the password.
    const operator = me({ company: { role: "operator" }, user: { mustChangePassword: true, onboardingCompleted: false } });
    expect(welcomeSteps(operator)).toEqual(["password"]);
  });

  test("invited admin with onboarding open: company details only", () => {
    const admin = me({ company: { role: "admin" }, user: { onboardingCompleted: false } });
    expect(welcomeSteps(admin)).toEqual(["company"]);
  });

  test("fully set-up member: nothing left", () => {
    expect(welcomeSteps(me())).toEqual([]);
    expect(welcomeSteps(me({ company: { role: "operator" } }))).toEqual([]);
  });
});

describe("welcomeSteps: edges", () => {
  test("invited operator or viewer with onboarding open never sees company details", () => {
    for (const role of ["operator", "viewer", "manager", "packer"] as const) {
      expect(welcomeSteps(me({ company: { role }, user: { onboardingCompleted: false } }))).toEqual([]);
    }
  });

  test("owner with onboarding open but not from a magic link: company details only, no two-factor", () => {
    expect(welcomeSteps(me({ user: { onboardingCompleted: false } }))).toEqual(["company"]);
  });

  test("magic-link owner who already turned on two-factor skips it", () => {
    const owner = me({ user: { onboardingCompleted: false, twoFactorEnabled: true } });
    expect(welcomeSteps(owner, { magic: true })).toEqual(["password", "company"]);
  });

  test("magic flag on a non-owner sets the password but never asks for two-factor", () => {
    const operator = me({ company: { role: "operator" }, user: { onboardingCompleted: false } });
    expect(welcomeSteps(operator, { magic: true })).toEqual(["password"]);
  });

  test("forced change and magic link together still ask for the password once", () => {
    const owner = me({ user: { mustChangePassword: true, onboardingCompleted: false } });
    expect(welcomeSteps(owner, { magic: true })).toEqual(["password", "twoFactor", "company"]);
  });

  test("a stale magic link on a set-up account asks for nothing", () => {
    // Old emails still point at /setup-credentials, which lands on /welcome?magic=1.
    expect(welcomeSteps(me(), { magic: true })).toEqual([]);
    expect(welcomeSteps(me({ user: { mustChangePassword: true } }), { magic: true })).toEqual(["password"]);
  });

  test("an impersonating admin has no company chores in someone else's company", () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const actor = me({
      isPlatformAdmin: true,
      platformRole: "super_admin",
      user: { onboardingCompleted: false },
      impersonation: grant,
    });
    expect(welcomeSteps(actor, { magic: true })).toEqual(["password"]);
    expect(welcomeSteps(actor)).toEqual([]);
    // Their own forced password change still stands: the guards send them here for it.
    const forced = me({ ...actor, user: { mustChangePassword: true, onboardingCompleted: false }, impersonation: grant });
    expect(welcomeSteps(forced)).toEqual(["password"]);
  });
});

describe("welcomeTimeline", () => {
  test("ends with done, and done alone when nothing is left", () => {
    expect(welcomeTimeline(["password", "company"])).toEqual(["password", "company", "done"]);
    expect(welcomeTimeline([])).toEqual(["done"]);
  });
});

describe("parseMagicFlag", () => {
  test("accepts 1 as a number or string, nothing else", () => {
    expect(parseMagicFlag(1)).toBe(true);
    expect(parseMagicFlag("1")).toBe(true);
    expect(parseMagicFlag(true)).toBe(false);
    expect(parseMagicFlag("yes")).toBe(false);
    expect(parseMagicFlag(undefined)).toBe(false);
  });
});

describe("COMPANY_SETUP_ROLES", () => {
  test("is exactly the roles the server lets write company settings", () => {
    // Every company role has a name in the dictionary (roles.*).
    const roles = Object.keys(en.roles) as NonNullable<Me["company"]>["role"][];
    expect(roles.length).toBeGreaterThanOrEqual(13);
    const writers = roles.filter((role) => can(me({ company: { role } }), "settings.update"));
    expect([...COMPANY_SETUP_ROLES].sort()).toEqual([...writers].sort());
  });
});
