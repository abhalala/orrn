import { describe, expect, test } from "bun:test";

import { afterResetLink, newPasswordError, parseResetSearch, resetLinkBroken, resetRedirectUrl } from "./password-reset";

describe("password reset helpers", () => {
  test("the link's query is read tolerantly", () => {
    expect(parseResetSearch({ token: "abc123" })).toEqual({ token: "abc123" });
    expect(parseResetSearch({ error: "INVALID_TOKEN" })).toEqual({ error: "INVALID_TOKEN" });
    expect(parseResetSearch({ token: "", error: 5 })).toEqual({});
    expect(parseResetSearch({ token: "x".repeat(300) })).toEqual({});
  });

  test("a link without a token, or with an error, is broken", () => {
    expect(resetLinkBroken({})).toBe(true);
    expect(resetLinkBroken({ error: "INVALID_TOKEN" })).toBe(true);
    expect(resetLinkBroken({ token: "abc", error: "INVALID_TOKEN" })).toBe(true);
    expect(resetLinkBroken({ token: "abc" })).toBe(false);
  });

  test("the server sends the person back to /reset-password on the same origin", () => {
    expect(resetRedirectUrl("https://app.orrn.in")).toBe("https://app.orrn.in/reset-password");
  });

  test("a same-origin next rides through the reset (Task 8: back to the invite); anything else is dropped", () => {
    expect(resetRedirectUrl("https://orrn.in", "/invite/abc-123")).toBe("https://orrn.in/reset-password?next=%2Finvite%2Fabc-123");
    expect(resetRedirectUrl("https://orrn.in", "//evil.com")).toBe("https://orrn.in/reset-password");
    expect(resetRedirectUrl("https://orrn.in", "https://evil.com")).toBe("https://orrn.in/reset-password");
    expect(parseResetSearch({ token: "abc", next: "/invite/abc-123" })).toEqual({ token: "abc", next: "/invite/abc-123" });
    expect(parseResetSearch({ token: "abc", next: "//evil.com" })).toEqual({ token: "abc" });
    expect(parseResetSearch({ next: 5 })).toEqual({});
  });

  test("after the reset: back to the invite, else sign in (carrying any other next)", () => {
    expect(afterResetLink("/invite/abc-123")).toEqual({ href: "/invite/abc-123", label: "auth.reset.backToInvite" });
    expect(afterResetLink("/stock")).toEqual({ href: "/login?next=%2Fstock", label: "auth.reset.goSignIn" });
    expect(afterResetLink(undefined)).toEqual({ href: "/login", label: "auth.reset.goSignIn" });
  });

  test("a new password needs 8 characters and the same twice", () => {
    expect(newPasswordError("short", "short")).toBe("auth.validation.passwordShort");
    expect(newPasswordError("long-enough-1", "long-enough-2")).toBe("auth.reset.mismatch");
    expect(newPasswordError("long-enough-1", "long-enough-1")).toBeNull();
    expect(newPasswordError("x".repeat(129), "x".repeat(129))).toBe("auth.validation.passwordShort");
  });
});
