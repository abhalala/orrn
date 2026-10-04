import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n";
import { can } from "@orrn/server/lib/permissions";

import type { Me } from "@/shared/lib/me";

import { COMPANY_SETUP_ROLES, leaveWelcome, needsPassword, welcomeSteps, welcomeTimeline } from "./welcome-steps";

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
  test("magic-link owner from waitlist approval (no password yet): password, two-factor, company", () => {
    const owner = me({ user: { onboardingCompleted: false, twoFactorEnabled: false, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "twoFactor", "company"]);
  });

  test("temp-password staff member (forced change): only the password step", () => {
    const staff = me({
      company: null,
      isPlatformAdmin: true,
      platformRole: "support",
      user: { mustChangePassword: true, onboardingCompleted: true, hasPassword: true },
    });
    expect(welcomeSteps(staff)).toEqual(["password"]);
    // A temp-password operator in a plant: still only the password.
    const operator = me({
      company: { role: "operator" },
      user: { mustChangePassword: true, onboardingCompleted: false, hasPassword: true },
    });
    expect(welcomeSteps(operator)).toEqual(["password"]);
  });

  test("invited admin with onboarding open: company details only", () => {
    const admin = me({ company: { role: "admin" }, user: { onboardingCompleted: false, hasPassword: true } });
    expect(welcomeSteps(admin)).toEqual(["company"]);
  });

  test("fully set-up member: nothing left", () => {
    expect(welcomeSteps(me())).toEqual([]);
    expect(welcomeSteps(me({ company: { role: "operator" } }))).toEqual([]);
  });
});

describe("welcomeSteps: derived from auth.me, not from how they arrived", () => {
  test("a magic-link owner who left before the password step gets it back on any later visit", () => {
    // Came back through /today (requireCompanyMe), a reload or a sign-in: no URL flag anywhere.
    const owner = me({ user: { onboardingCompleted: false, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "twoFactor", "company"]);
  });

  test("a reload after the password was set resumes at two-factor, not at 'Set your password'", () => {
    const owner = me({ user: { onboardingCompleted: false, hasPassword: true, twoFactorEnabled: false } });
    expect(welcomeSteps(owner)).toEqual(["twoFactor", "company"]);
  });

  test("an owner who set a password, signed out and signed back in still has to turn on two-factor", () => {
    const owner = me({ user: { onboardingCompleted: false, hasPassword: true } });
    expect(welcomeSteps(owner)).toContain("twoFactor");
  });

  test("any owner with onboarding open and two-factor off is asked for it, invited owners too", () => {
    expect(welcomeSteps(me({ user: { onboardingCompleted: false, hasPassword: true } }))).toEqual(["twoFactor", "company"]);
  });

  test("an owner who already turned on two-factor skips it", () => {
    const owner = me({ user: { onboardingCompleted: false, twoFactorEnabled: true, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "company"]);
  });

  test("a set-up account with no password is asked for one (it could never sign in again)", () => {
    expect(welcomeSteps(me({ user: { hasPassword: false } }))).toEqual(["password"]);
    // Two-factor is a first-setup step only.
    expect(welcomeSteps(me({ user: { hasPassword: false, twoFactorEnabled: false } }))).not.toContain("twoFactor");
  });

  test("an older auth.me without hasPassword is read as having one", () => {
    const owner = me({ user: { onboardingCompleted: false } });
    expect("hasPassword" in owner.user).toBe(false);
    expect(welcomeSteps(owner)).toEqual(["twoFactor", "company"]);
  });
});

describe("welcomeSteps: edges", () => {
  test("invited operator or viewer with onboarding open never sees company details or two-factor", () => {
    for (const role of ["operator", "viewer", "manager", "packer"] as const) {
      expect(welcomeSteps(me({ company: { role }, user: { onboardingCompleted: false, hasPassword: true } }))).toEqual([]);
    }
  });

  test("a non-owner without a password sets one but is never asked for two-factor", () => {
    const operator = me({ company: { role: "operator" }, user: { onboardingCompleted: false, hasPassword: false } });
    expect(welcomeSteps(operator)).toEqual(["password"]);
  });

  test("forced change and no password together still ask for the password once", () => {
    const owner = me({ user: { mustChangePassword: true, onboardingCompleted: false, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "twoFactor", "company"]);
  });

  test("an impersonating admin has no company chores in someone else's company", () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const actor = me({
      isPlatformAdmin: true,
      platformRole: "super_admin",
      user: { onboardingCompleted: false, hasPassword: true },
      impersonation: grant,
    });
    expect(welcomeSteps(actor)).toEqual([]);
    // Their own forced password change still stands: the guards send them here for it.
    const forced = me({ ...actor, user: { mustChangePassword: true, onboardingCompleted: false }, impersonation: grant });
    expect(welcomeSteps(forced)).toEqual(["password"]);
  });
});

describe("needsPassword", () => {
  test("a forced change or no password at all", () => {
    expect(needsPassword(me({ user: { mustChangePassword: true, hasPassword: true } }))).toBe(true);
    expect(needsPassword(me({ user: { hasPassword: false } }))).toBe(true);
    expect(needsPassword(me({ user: { hasPassword: true } }))).toBe(false);
    expect(needsPassword(me())).toBe(false);
  });
});

describe("leaveWelcome", () => {
  test("stays while a step is open", () => {
    const owner = me({ user: { onboardingCompleted: false, hasPassword: false } });
    expect(leaveWelcome(owner, welcomeSteps(owner))).toBe(false);
    // A set-up account with no password stays for the password step instead of bouncing home.
    const passwordless = me({ user: { hasPassword: false } });
    expect(leaveWelcome(passwordless, welcomeSteps(passwordless))).toBe(false);
  });

  test("an invited member whose only open item is the onboarding flag stays for the closing screen", () => {
    const operator = me({ company: { role: "operator" }, user: { onboardingCompleted: false, hasPassword: true } });
    expect(welcomeSteps(operator)).toEqual([]);
    expect(leaveWelcome(operator, [])).toBe(false);
  });

  test("leaves when set up, impersonating, or in no company (their home is elsewhere)", () => {
    expect(leaveWelcome(me(), [])).toBe(true);
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    expect(leaveWelcome(me({ user: { onboardingCompleted: false }, impersonation: grant }), [])).toBe(true);
    // Signed up on their own, no company: /no-access explains, a "You're set up" screen would not.
    expect(leaveWelcome(me({ company: null, user: { onboardingCompleted: false } }), [])).toBe(true);
    // Staff with the flag open go to the console.
    const staff = me({ company: null, isPlatformAdmin: true, platformRole: "support", user: { onboardingCompleted: false } });
    expect(leaveWelcome(staff, [])).toBe(true);
  });
});

describe("welcomeTimeline", () => {
  test("ends with done, and done alone when nothing is left", () => {
    expect(welcomeTimeline(["password", "company"])).toEqual(["password", "company", "done"]);
    expect(welcomeTimeline([])).toEqual(["done"]);
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
