import { describe, expect, test } from "bun:test";

import { googleLinkErrorKey, googleLinkUrls, linkRemovals } from "./google-link";

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

// Council round 1, A9: the warning before linking Google to an unconfirmed email lists only what goes.
describe("linkRemovals", () => {
  test("lists only the methods the account has, then other devices", () => {
    expect(linkRemovals({ password: true, passkeys: 0, authenticator: false })).toEqual([
      { key: "settings.signIn.linkWipesPassword" },
      { key: "settings.signIn.linkWipesDevices" },
    ]);
    expect(linkRemovals({ password: true, passkeys: 2, authenticator: true })).toEqual([
      { key: "settings.signIn.linkWipesPassword" },
      { key: "settings.signIn.linkWipesPasskeys", count: 2 },
      { key: "settings.signIn.linkWipesAuthenticator" },
      { key: "settings.signIn.linkWipesDevices" },
    ]);
    expect(linkRemovals({ password: false, passkeys: 1, authenticator: false })).toEqual([
      { key: "settings.signIn.linkWipesPasskeys", count: 1 },
      { key: "settings.signIn.linkWipesDevices" },
    ]);
    expect(linkRemovals({ password: false, passkeys: 0, authenticator: false })).toEqual([{ key: "settings.signIn.linkWipesDevices" }]);
  });

  test("unknown (the list did not load): names everything that could go", () => {
    expect(linkRemovals(undefined)).toEqual([
      { key: "settings.signIn.linkWipesPassword" },
      { key: "settings.signIn.linkWipesPasskeys", count: 2 },
      { key: "settings.signIn.linkWipesAuthenticator" },
      { key: "settings.signIn.linkWipesDevices" },
    ]);
  });
});

// Council round 2 (N-C1): a weak session in a strict plant may not add a strong method it already has.
describe("the enrolment refusal (STRONG_SIGN_IN_NEEDED) reads in its own words", () => {
  test("a refused start and a refused return", async () => {
    const { startGoogleLink } = await import("./google-link");
    const refused = async () => ({ data: null, error: { code: "STRONG_SIGN_IN_NEEDED", status: 403 } });
    expect(await startGoogleLink(refused, "https://orrn.in", "/settings")).toBe("auth.login.strongSignInNeededPlant");
    expect(googleLinkErrorKey("STRONG_SIGN_IN_NEEDED")).toBe("auth.login.strongSignInNeededPlant");
  });

  test("adding a passkey, turning on the authenticator app, and the Settings refusal", async () => {
    const { passkeyAddErrorKey } = await import("./passkey-add");
    const { totpErrorKey } = await import("./auth-errors");
    const { signInChangeErrorKey } = await import("../settings/sign-in-model");
    const error = { code: "STRONG_SIGN_IN_NEEDED", status: 403 };
    expect(passkeyAddErrorKey(error)).toBe("auth.login.strongSignInNeededPlant");
    expect(totpErrorKey(error)).toBe("auth.login.strongSignInNeededPlant");
    expect(signInChangeErrorKey(error)).toBe("auth.login.strongSignInNeededPlant");
  });
});
