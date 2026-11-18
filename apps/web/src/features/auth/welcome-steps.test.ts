import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n/en";
import { can } from "@orrn/server/lib/permissions";

import type { Me } from "@/shared/lib/me";

import { needsWelcome } from "@/shared/lib/home";

import { COMPANY_SETUP_ROLES, hasStrongMethod, leaveWelcome, needsPassword, welcomeSteps, welcomeTimeline } from "./welcome-steps";

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
  test("magic-link owner from waitlist approval (no password yet): password, company (two-factor is opt-in)", () => {
    const owner = me({ user: { onboardingCompleted: false, twoFactorEnabled: false, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "company"]);
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
    expect(welcomeSteps(owner)).toEqual(["password", "company"]);
  });

  test("a reload after the password was set resumes at company details, not at 'Set your password'", () => {
    const owner = me({ user: { onboardingCompleted: false, hasPassword: true, twoFactorEnabled: false } });
    expect(welcomeSteps(owner)).toEqual(["company"]);
  });

  test("a set-up account with no password is asked for one (it could never sign in again)", () => {
    expect(welcomeSteps(me({ user: { hasPassword: false } }))).toEqual(["password"]);
  });

  test("an older auth.me without hasPassword is read as having one", () => {
    const owner = me({ user: { onboardingCompleted: false } });
    expect("hasPassword" in owner.user).toBe(false);
    expect(welcomeSteps(owner)).toEqual(["company"]);
  });

  test("an older auth.me without setupPending falls back to the user's onboarding flag", () => {
    expect(welcomeSteps(me({ user: { onboardingCompleted: false, hasPassword: true } }))).toEqual(["company"]);
    expect(welcomeSteps(me({ user: { onboardingCompleted: true, hasPassword: true } }))).toEqual([]);
  });
});

describe("welcomeSteps: edges", () => {
  test("invited operator or viewer with onboarding open never sees company details or a secure step", () => {
    for (const role of ["operator", "viewer", "manager", "packer"] as const) {
      expect(welcomeSteps(me({ company: { role }, user: { onboardingCompleted: false, hasPassword: true } }))).toEqual([]);
    }
  });

  test("a non-owner without a password sets one and nothing else", () => {
    const operator = me({ company: { role: "operator" }, user: { onboardingCompleted: false, hasPassword: false } });
    expect(welcomeSteps(operator)).toEqual(["password"]);
  });

  test("forced change and no password together still ask for the password once", () => {
    const owner = me({ user: { mustChangePassword: true, onboardingCompleted: false, hasPassword: false } });
    expect(welcomeSteps(owner)).toEqual(["password", "company"]);
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

describe("passkeys and Google (plan 2026-11-18)", () => {
  test("welcomeSteps never asks for two-factor by default, owners included (owner amendment)", () => {
    const open = { onboardingCompleted: false, twoFactorEnabled: false, hasPassword: true };
    for (const role of ["owner", "admin", "operator"] as const) {
      expect(welcomeSteps(me({ company: { role }, user: open }))).not.toContain("secureSignIn");
    }
    expect(welcomeSteps(me({ user: open }))).toEqual(["company"]);
  });

  test("needsPassword is false for a google-only or passkey-only user", () => {
    expect(needsPassword(me({ user: { hasPassword: false, hasGoogle: true } }))).toBe(false);
    expect(needsPassword(me({ user: { hasPassword: false, hasPasskey: true } }))).toBe(false);
    expect(needsPassword(me({ user: { hasPassword: false, hasPasskey: false, hasGoogle: false } }))).toBe(true);
    // A forced change still asks, whatever else the account has.
    expect(needsPassword(me({ user: { mustChangePassword: true, hasGoogle: true } }))).toBe(true);
  });

  test("a google-only owner is asked for neither a password nor two-factor", () => {
    const owner = me({ user: { onboardingCompleted: false, hasPassword: false, hasGoogle: true } });
    expect(welcomeSteps(owner)).toEqual(["company"]);
  });

  test("google-only user gets no password step, in a plant that requires secure sign-in too", () => {
    const strict = { requireStrongSignIn: true, setupPending: true, role: "packer" as const };
    expect(welcomeSteps(me({ company: strict, user: { hasPassword: false, hasGoogle: true } }))).toEqual([]);
    expect(welcomeSteps(me({ company: strict, user: { hasPassword: false, hasPasskey: true } }))).toEqual([]);
  });

  test("hasStrongMethod: authenticator, passkey or Google", () => {
    expect(hasStrongMethod(me())).toBe(false);
    expect(hasStrongMethod(me({ user: { twoFactorEnabled: true } }))).toBe(true);
    expect(hasStrongMethod(me({ user: { hasPasskey: true } }))).toBe(true);
    expect(hasStrongMethod(me({ user: { hasGoogle: true } }))).toBe(true);
  });
});

describe("plant policy and per-plant onboarding (owner amendment 2026-11-18, Task 9)", () => {
  test("policy on and no strong method: secureSignIn, in any role, set up or not", () => {
    for (const role of ["owner", "admin", "packer", "viewer"] as const) {
      const member = me({ company: { role, requireStrongSignIn: true, setupPending: false }, user: { hasPassword: true } });
      expect({ role, steps: welcomeSteps(member) }).toEqual({ role, steps: ["secureSignIn"] });
    }
  });

  test("policy on with a strong method: no secure step", () => {
    const strict = { requireStrongSignIn: true, setupPending: false };
    expect(welcomeSteps(me({ company: strict, user: { twoFactorEnabled: true } }))).toEqual([]);
    expect(welcomeSteps(me({ company: strict, user: { hasPasskey: true } }))).toEqual([]);
    expect(welcomeSteps(me({ company: strict, user: { hasGoogle: true } }))).toEqual([]);
  });

  test("policy off: no secure step", () => {
    expect(welcomeSteps(me({ company: { requireStrongSignIn: false, setupPending: false } }))).toEqual([]);
    expect(welcomeSteps(me({ company: { setupPending: false } }))).toEqual([]);
  });

  test("owner of a new plant: company details (setupPending wins over the user flag)", () => {
    // Set up in another plant (the user flag is on), new in this one.
    const owner = me({ company: { role: "owner", setupPending: true }, user: { onboardingCompleted: true, hasPassword: true } });
    expect(welcomeSteps(owner)).toEqual(["company"]);
    // And the other way round: this plant done, the old user flag still off.
    expect(welcomeSteps(me({ company: { role: "owner", setupPending: false }, user: { onboardingCompleted: false } }))).toEqual([]);
  });

  test("policy on, new plant, owner without a strong method: password first, then secure, then company", () => {
    const owner = me({
      company: { role: "owner", requireStrongSignIn: true, setupPending: true },
      user: { hasPassword: false },
    });
    expect(welcomeSteps(owner)).toEqual(["password", "secureSignIn", "company"]);
  });

  test("an impersonating admin is never sent to a plant's secure step", () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const actor = me({ company: { requireStrongSignIn: true, setupPending: true }, impersonation: grant, isPlatformAdmin: true, platformRole: "super_admin" });
    expect(welcomeSteps(actor)).toEqual([]);
    expect(needsWelcome(actor)).toBe(false);
  });

  test("whenever the guards send someone to /welcome, /welcome keeps them (no redirect loop)", () => {
    const grant = { actorUserId: "u1", companyId: "c1", grantId: "g1", expiresAt: "2099-01-01T00:00:00.000Z" };
    const cases: Me[] = [];
    for (const role of ["owner", "admin", "operator", "viewer"] as const) {
      for (const requireStrongSignIn of [true, false, undefined]) {
        for (const setupPending of [true, false, undefined]) {
          for (const onboardingCompleted of [true, false]) {
            for (const strong of [false, true]) {
              for (const hasPassword of [true, false]) {
                for (const impersonation of [null, grant]) {
                  cases.push(
                    me({
                      company: { role, requireStrongSignIn, setupPending },
                      user: { onboardingCompleted, hasPasskey: strong, hasPassword },
                      impersonation,
                    }),
                  );
                }
              }
            }
          }
        }
      }
    }
    cases.push(me({ company: null, user: { hasPassword: false } }), me({ company: null, user: { onboardingCompleted: false } }));
    for (const m of cases) {
      const steps = welcomeSteps(m);
      // Sent to /welcome: /welcome must not send them away. Not sent: /welcome must not hold them.
      expect({ m, stays: !leaveWelcome(m, steps) }).toEqual({ m, stays: needsWelcome(m) });
    }
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
