import { describe, expect, test } from "bun:test";

import { en } from "@orrn/i18n";

import { afterPassword, afterTotp, cleanTotp } from "../lib/sign-in-flow";

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  return typeof node === "string";
}

describe("afterPassword", () => {
  test("a 2FA account moves to the code step instead of 'succeeding' with no session (N5)", () => {
    expect(afterPassword({ data: { twoFactorRedirect: true }, error: null })).toEqual({ step: "totp" });
  });

  test("a normal account is done", () => {
    expect(afterPassword({ data: { token: "t", user: {} }, error: null })).toEqual({ step: "done" });
  });

  test("wrong email or password says so", () => {
    const r = afterPassword({ data: null, error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" } });
    expect(r).toEqual({ step: "error", messageKey: "auth.login.wrongCredentials" });
  });

  test("rate limit and network failures get their own copy", () => {
    expect(afterPassword({ data: null, error: { status: 429 } })).toEqual({ step: "error", messageKey: "native.tooManyTries" });
    expect(afterPassword({ data: null, error: { status: 0 } })).toEqual({ step: "error", messageKey: "errors.network" });
    expect(afterPassword({ data: null, error: { status: 500 } })).toEqual({ step: "error", messageKey: "errors.generic" });
  });
});

describe("afterTotp", () => {
  test("a good code is done", () => {
    expect(afterTotp({ data: { token: "t" }, error: null })).toEqual({ step: "done" });
  });

  test("a wrong code stays on the code step", () => {
    expect(afterTotp({ data: null, error: { status: 401, code: "INVALID_CODE" } })).toEqual({
      step: "error",
      messageKey: "auth.totp.wrongCode",
    });
  });

  test("an expired 2FA cookie sends the person back to email and password", () => {
    expect(afterTotp({ data: null, error: { status: 401, code: "INVALID_TWO_FACTOR_COOKIE" } })).toEqual({
      step: "restart",
      messageKey: "native.codeTimedOut",
    });
  });

  test("too many attempts", () => {
    expect(afterTotp({ data: null, error: { status: 429, code: "TOO_MANY_ATTEMPTS" } })).toEqual({
      step: "error",
      messageKey: "native.tooManyTries",
    });
  });
});

describe("cleanTotp", () => {
  test("keeps the first six digits, drops spaces and dashes from pasted codes", () => {
    expect(cleanTotp("123 456")).toBe("123456");
    expect(cleanTotp("12-34-5678")).toBe("123456");
    expect(cleanTotp("abc")).toBe("");
  });
});

describe("every message key exists in en", () => {
  test("keys used by the flow", () => {
    for (const k of [
      "auth.login.wrongCredentials",
      "auth.totp.wrongCode",
      "native.tooManyTries",
      "native.codeTimedOut",
      "errors.network",
      "errors.generic",
    ]) {
      expect(has(k)).toBe(true);
    }
  });
});
