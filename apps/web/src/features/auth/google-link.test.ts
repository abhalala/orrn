import { describe, expect, test } from "bun:test";

import { googleLinkErrorKey, googleLinkUrls } from "./google-link";

describe("googleLinkUrls", () => {
  test("Google comes back to the page that asked, on the web origin, both ways", () => {
    expect(googleLinkUrls("https://orrn.in", "/settings?tab=sign-in")).toEqual({
      callbackURL: "https://orrn.in/settings?tab=sign-in",
      errorCallbackURL: "https://orrn.in/settings?tab=sign-in",
    });
    expect(googleLinkUrls("http://localhost:3305", "/welcome")).toEqual({
      callbackURL: "http://localhost:3305/welcome",
      errorCallbackURL: "http://localhost:3305/welcome",
    });
  });

  test("never another host", () => {
    expect(googleLinkUrls("https://orrn.in", "//evil.example/x").callbackURL).toBe("https://orrn.in/");
    expect(googleLinkUrls("https://orrn.in", "https://evil.example/x").callbackURL).toBe("https://orrn.in/");
  });
});

describe("googleLinkErrorKey: the ?error= Better Auth sends back, as words", () => {
  test("no error, no message", () => {
    expect(googleLinkErrorKey(undefined)).toBeNull();
    expect(googleLinkErrorKey("")).toBeNull();
  });

  test("another email, another account, staff", () => {
    expect(googleLinkErrorKey("email_doesn't_match")).toBe("auth.errors.googleLinkOtherEmail");
    expect(googleLinkErrorKey("account_already_linked_to_different_user")).toBe("auth.errors.googleLinkTaken");
    expect(googleLinkErrorKey("GOOGLE_NOT_FOR_STAFF")).toBe("auth.errors.googleNotForStaff");
  });

  test("anything else reads as the generic link failure, never the code", () => {
    expect(googleLinkErrorKey("unable_to_link_account")).toBe("auth.errors.googleLinkFailed");
    expect(googleLinkErrorKey("access_denied")).toBe("auth.errors.googleLinkFailed");
  });
});
