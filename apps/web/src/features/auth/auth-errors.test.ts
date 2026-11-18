import { describe, expect, test } from "bun:test";

import {
  inviteAcceptOutcome,
  inviteSignUpRefusal,
  isExistingAccount,
  loginErrorKey,
  offersPasswordLink,
  signInErrorKey,
  totpErrorKey,
} from "./auth-errors";

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

describe("signInErrorKey: passkey and Google (plan 2026-11-18)", () => {
  test("Google refusals from the server get their own words", () => {
    expect(signInErrorKey({ code: "GOOGLE_NOT_INVITED", status: 403 })).toBe("auth.errors.googleNotInvited");
    expect(signInErrorKey({ code: "GOOGLE_NOT_FOR_STAFF", status: 403 })).toBe("auth.errors.googleNotForStaff");
    expect(signInErrorKey({ code: "GOOGLE_EMAIL_NOT_VERIFIED", status: 403 })).toBe("auth.errors.googleEmailNotVerified");
  });

  test("a cancelled passkey sheet reads as cancelled, never as a wrong password", () => {
    // The passkey client turns every browser failure into AUTH_CANCELLED.
    expect(signInErrorKey({ code: "AUTH_CANCELLED", status: 400 })).toBe("auth.errors.passkeyCancelled");
    expect(signInErrorKey(new DOMException("The operation either timed out or was not allowed.", "NotAllowedError"))).toBe(
      "auth.errors.passkeyCancelled",
    );
    const named = new Error("not allowed");
    named.name = "NotAllowedError";
    expect(signInErrorKey(named)).toBe("auth.errors.passkeyCancelled");
  });

  test("a passkey the server does not know (status 401) is not 'email or password is wrong'", () => {
    expect(signInErrorKey({ code: "PASSKEY_NOT_FOUND", status: 401 })).toBe("auth.errors.passkeyNotFound");
    expect(signInErrorKey({ code: "AUTHENTICATION_FAILED", status: 401 })).toBe("auth.errors.passkeyNotFound");
  });
});

describe("loginErrorKey (the sign-in page's ?error=, from the Google callback and the API error page)", () => {
  test("the server's Google refusal codes", () => {
    expect(loginErrorKey("GOOGLE_NOT_INVITED")).toBe("auth.errors.googleNotInvited");
    expect(loginErrorKey("GOOGLE_NOT_FOR_STAFF")).toBe("auth.errors.googleNotForStaff");
    expect(loginErrorKey("GOOGLE_EMAIL_NOT_VERIFIED")).toBe("auth.errors.googleEmailNotVerified");
  });

  test("any other code (Better Auth's own lower-case ones, UNKNOWN, junk) is the generic message", () => {
    for (const code of ["access_denied", "state_mismatch", "please_restart_the_process", "UNKNOWN", "<script>", "x".repeat(500)]) {
      expect(loginErrorKey(code)).toBe("auth.errors.signInFailed");
    }
  });

  test("no ?error= means no message", () => {
    expect(loginErrorKey(undefined)).toBeNull();
    // Council r1 A4: the plant's secure sign-in notice is its own block, not the form's error.
    expect(loginErrorKey("STRONG_SIGN_IN_NEEDED")).toBeNull();
    expect(loginErrorKey("")).toBeNull();
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

describe("inviteSignUpRefusal (sign-up needs a live invite, security review 2026-11-04)", () => {
  test("the server's invite refusals map to the invite page's views; anything else is not one", () => {
    expect(inviteSignUpRefusal({ code: "SIGN_UP_INVITE_EMAIL_MISMATCH", status: 403 })).toBe("wrongEmail");
    expect(inviteSignUpRefusal({ code: "SIGN_UP_INVITE_NOT_VALID", status: 403 })).toBe("expired");
    expect(inviteSignUpRefusal({ code: "SIGN_UP_NEEDS_INVITE", status: 403 })).toBe("expired");
    expect(inviteSignUpRefusal({ code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL", status: 422 })).toBeNull();
    expect(inviteSignUpRefusal(new TypeError("offline"))).toBeNull();
    expect(inviteSignUpRefusal(null)).toBeNull();
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

describe("no password yet (plan 2026-11-18, Task 8)", () => {
  test("CREDENTIAL_ACCOUNT_NOT_FOUND reads as no password yet", () => {
    expect(signInErrorKey({ code: "CREDENTIAL_ACCOUNT_NOT_FOUND", status: 401 })).toBe("auth.errors.noPasswordYet");
  });

  test("the set-a-password link is offered on no password yet and on a wrong email or password (Better Auth says the same for both)", () => {
    expect(offersPasswordLink("auth.errors.noPasswordYet")).toBe(true);
    expect(offersPasswordLink("auth.login.wrongCredentials")).toBe(true);
    expect(offersPasswordLink("auth.errors.tooMany")).toBe(false);
    expect(offersPasswordLink("errors.network")).toBe(false);
    expect(offersPasswordLink(null)).toBe(false);
  });
});
