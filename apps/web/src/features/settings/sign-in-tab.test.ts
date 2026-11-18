import { describe, expect, test } from "bun:test";

import type { Me } from "@orrn/server/lib/permissions";

import { sectionVisible } from "./model";
import { canRemove, methodCounts, signInChangeErrorKey, type Methods } from "./sign-in-model";

const methods = (over: Partial<Methods> = {}): Methods => ({ password: false, passkeys: 0, google: false, authenticator: false, ...over });

/**
 * `canRemove` mirrors the server's guard (`signInMethodGuardBody`, packages/auth/src/sign-in-methods.ts)
 * so the Sign-in tab can disable a button and say why; the server stays the judge.
 */
describe("canRemove: the last way in", () => {
  test("the only passkey of an account with no password or Google: LAST_SIGN_IN_METHOD", () => {
    expect(canRemove(methods({ passkeys: 1 }), "passkey", false)).toEqual({ ok: false, code: "LAST_SIGN_IN_METHOD" });
  });

  test("Google as the only way in: LAST_SIGN_IN_METHOD", () => {
    expect(canRemove(methods({ google: true }), "google", false)).toEqual({ ok: false, code: "LAST_SIGN_IN_METHOD" });
  });

  test("the authenticator app is a second factor, never the last way in", () => {
    expect(canRemove(methods({ password: true, authenticator: true }), "authenticator", false)).toEqual({ ok: true });
  });

  test("both rules trip: LAST_SIGN_IN_METHOD wins, as on the server", () => {
    expect(canRemove(methods({ passkeys: 1 }), "passkey", true)).toEqual({ ok: false, code: "LAST_SIGN_IN_METHOD" });
  });

  test("a password stays: removing the only passkey is fine without the policy", () => {
    expect(canRemove(methods({ password: true, passkeys: 1 }), "passkey", false)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true, google: true }), "google", false)).toEqual({ ok: true });
  });
});

describe("canRemove: a plant that requires secure sign-in", () => {
  test("the last strong method with only a password left: COMPANY_REQUIRES_STRONG_METHOD", () => {
    expect(canRemove(methods({ password: true, passkeys: 1 }), "passkey", true)).toEqual({ ok: false, code: "COMPANY_REQUIRES_STRONG_METHOD" });
    expect(canRemove(methods({ password: true, google: true }), "google", true)).toEqual({ ok: false, code: "COMPANY_REQUIRES_STRONG_METHOD" });
    expect(canRemove(methods({ password: true, authenticator: true }), "authenticator", true)).toEqual({
      ok: false,
      code: "COMPANY_REQUIRES_STRONG_METHOD",
    });
  });

  test("another strong method stays: fine", () => {
    expect(canRemove(methods({ password: true, passkeys: 1, authenticator: true }), "passkey", true)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true, google: true, passkeys: 1 }), "google", true)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true, authenticator: true, google: true }), "authenticator", true)).toEqual({ ok: true });
  });

  test("one of several passkeys: fine, with or without the policy", () => {
    expect(canRemove(methods({ passkeys: 2 }), "passkey", true)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true, passkeys: 3 }), "passkey", true)).toEqual({ ok: true });
  });
});

describe("canRemove: nothing to remove", () => {
  test("a method the account does not have: the server answers that itself, so no reason here", () => {
    expect(canRemove(methods({ password: true }), "passkey", true)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true }), "google", true)).toEqual({ ok: true });
    expect(canRemove(methods({ password: true }), "authenticator", true)).toEqual({ ok: true });
  });
});

describe("methodCounts", () => {
  test("the passkey list becomes a count; the rest is kept", () => {
    const listed = { password: true, google: false, authenticator: true, passkeys: [{ id: "a" }, { id: "b" }], requiredByPlant: true };
    expect(methodCounts(listed)).toEqual({ password: true, google: false, authenticator: true, passkeys: 2 });
  });
});

describe("signInChangeErrorKey: server refusals as words, never the server's text", () => {
  test("the two guard codes", () => {
    expect(signInChangeErrorKey({ code: "LAST_SIGN_IN_METHOD", status: 403, message: "raw" })).toBe("settings.signIn.reasonLast");
    expect(signInChangeErrorKey({ code: "COMPANY_REQUIRES_STRONG_METHOD", status: 403, message: "raw" })).toBe("settings.signIn.reasonPlant");
  });

  test("a session older than a day asks them to sign in again", () => {
    expect(signInChangeErrorKey({ code: "SESSION_NOT_FRESH", status: 403 })).toBe("auth.errors.signInAgain");
  });

  test("a wrong password (turning the authenticator off)", () => {
    expect(signInChangeErrorKey({ code: "INVALID_PASSWORD", status: 400 })).toBe("welcome.twoFactor.wrongPassword");
  });

  test("network, rate limit, anything else", () => {
    expect(signInChangeErrorKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(signInChangeErrorKey({ status: 429 })).toBe("auth.errors.tooMany");
    expect(signInChangeErrorKey({ code: "SOMETHING_NEW", status: 500, message: "A brand new sentence" })).toBe("errors.generic");
    expect(signInChangeErrorKey(null)).toBe("errors.generic");
  });
});

describe("sectionVisible: the Sign-in tab is the person's own account", () => {
  const me = (over: Partial<Me> = {}) =>
    ({
      user: { id: "u1", name: "Asha Rana", email: "asha@fourcubes.in" },
      company: { id: "c1", name: "Fourcubes", slug: "fourcubes", status: "active", plan: null, role: "packer" },
      isPlatformAdmin: false,
      platformRole: null,
      impersonation: null,
      ...over,
    }) as Me;
  const signIn = { ownAccount: true };

  test("every role sees it (no requires)", () => {
    expect(sectionVisible(signIn, me())).toBe(true);
  });

  test("never while a Godseye admin impersonates the plant", () => {
    expect(sectionVisible(signIn, me({ impersonation: { actorUserId: "a1", companyId: "c1", grantId: "g1", expiresAt: "2026-11-18T12:00:00.000Z" } }))).toBe(false);
  });

  test("requires still hides a plant tab from a role without the action", () => {
    expect(sectionVisible({ requires: ["settings.update"] }, me())).toBe(false);
    expect(sectionVisible({ requires: ["settings.update"] }, me({ company: { id: "c1", name: "F", slug: "f", status: "active", plan: null, role: "owner" } as Me["company"] }))).toBe(true);
  });
});
