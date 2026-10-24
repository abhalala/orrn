import { describe, expect, test } from "bun:test";

import { inviteAcceptOutcome, isExistingAccount, signInErrorKey, totpErrorKey } from "./auth-errors";

describe("signInErrorKey", () => {
  test("wrong email or password reads as the inline credentials error", () => {
    expect(signInErrorKey({ code: "INVALID_EMAIL_OR_PASSWORD", status: 401 })).toBe("auth.login.wrongCredentials");
    expect(signInErrorKey({ status: 401 })).toBe("auth.login.wrongCredentials");
  });

  test("rate limits, network failures and anything else get their own words", () => {
    expect(signInErrorKey({ status: 429 })).toBe("auth.errors.tooMany");
    expect(signInErrorKey({ code: "TOO_MANY_REQUESTS", status: 400 })).toBe("auth.errors.tooMany");
    expect(signInErrorKey({ status: 0 })).toBe("errors.network");
    expect(signInErrorKey(new TypeError("Failed to fetch"))).toBe("errors.network");
    expect(signInErrorKey({ code: "SOMETHING_NEW", status: 500 })).toBe("errors.generic");
    expect(signInErrorKey(undefined)).toBe("errors.generic");
  });
});

describe("totpErrorKey", () => {
  test("a wrong code, too many tries, and an expired two-factor sign-in", () => {
    expect(totpErrorKey({ code: "INVALID_CODE", status: 401 })).toBe("auth.totp.wrongCode");
    expect(totpErrorKey({ code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE", status: 429 })).toBe("auth.errors.tooMany");
    expect(totpErrorKey({ code: "INVALID_TWO_FACTOR_COOKIE", status: 401 })).toBe("auth.errors.twoFactorExpired");
    expect(totpErrorKey({ status: 0 })).toBe("errors.network");
  });
});

describe("isExistingAccount (invite sign-up, audit N4)", () => {
  test("both Better Auth codes for an email that already has an account", () => {
    expect(isExistingAccount({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 })).toBe(true);
    expect(isExistingAccount({ code: "USER_ALREADY_EXISTS", status: 422 })).toBe(true);
    expect(isExistingAccount({ code: "PASSWORD_TOO_SHORT", status: 400 })).toBe(false);
    expect(isExistingAccount(null)).toBe(false);
  });
});

describe("inviteAcceptOutcome", () => {
  test("maps the accept errors to what the invite page shows", () => {
    expect(inviteAcceptOutcome({ data: { code: "FORBIDDEN" } })).toBe("wrongEmail");
    expect(inviteAcceptOutcome({ data: { code: "NOT_FOUND" } })).toBe("expired");
    expect(inviteAcceptOutcome({ data: { code: "BAD_REQUEST" } })).toBe("expired");
    expect(inviteAcceptOutcome({ data: { code: "INTERNAL_SERVER_ERROR" } })).toBe("failed");
    expect(inviteAcceptOutcome(new TypeError("Failed to fetch"))).toBe("failed");
  });
});
