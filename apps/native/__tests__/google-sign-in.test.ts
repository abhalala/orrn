import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { en } from "@orrn/i18n/en";

import { authCookieStorageKey, googleReturnErrorKey, googleSignInWith, type GoogleDeps } from "../lib/google-flow";

/**
 * "Continue with Google" on the phone (plan 2026-11-18, Task 6). The Expo auth client's own browser
 * step returns nothing when the server refuses (its hook drops `?error=`), so the phone runs that step
 * itself: start with `disableRedirect`, open the server's Expo proxy in an ephemeral auth session, then
 * read the deep link it comes back on. A refusal (`GOOGLE_NOT_INVITED`, `GOOGLE_NOT_FOR_STAFF`,
 * `GOOGLE_EMAIL_NOT_VERIFIED`) is a message in the user's language; the server's text is never shown.
 */

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const RETURN = "orrn:///";
const API = "https://api.orrn.in/api/auth";

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  return typeof node === "string";
}

function deps(over: Partial<GoogleDeps> & { resultUrl?: string; resultType?: string } = {}) {
  const log: { started?: unknown; opened?: [string, string]; options?: unknown; stored: string[] } = { stored: [] };
  const d: GoogleDeps = {
    start: async (body) => {
      log.started = body;
      return { data: { url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc&client_id=x", redirect: false }, error: null };
    },
    openAuthSession: async (url, returnUrl, options) => {
      log.opened = [url, returnUrl];
      log.options = options;
      return over.resultType && over.resultType !== "success" ? { type: over.resultType } : { type: "success", url: over.resultUrl };
    },
    storeCookie: (header) => {
      log.stored.push(header);
    },
    returnUrl: RETURN,
    authBaseUrl: API,
    ...over,
  };
  return { d, log };
}

describe("the Google round trip", () => {
  test("starts without a redirect, with one deep link for success and refusal, opens the Expo proxy", async () => {
    const cookie = "__Host-better-auth.session_token=tok; Path=/; HttpOnly; Secure; SameSite=None";
    const { d, log } = deps({ resultUrl: `${RETURN}?cookie=${encodeURIComponent(cookie)}` });
    expect(await googleSignInWith(d)).toEqual({ step: "done" });
    // Android's auth session matches the return by prefix, so success and refusal share one link.
    expect(log.started).toEqual({ provider: "google", callbackURL: RETURN, errorCallbackURL: RETURN, disableRedirect: true });
    const [opened, returnUrl] = log.opened!;
    expect(returnUrl).toBe(RETURN);
    const proxy = new URL(opened);
    expect(`${proxy.origin}${proxy.pathname}`).toBe(`${API}/expo-authorization-proxy`);
    expect(proxy.searchParams.get("authorizationURL")).toBe("https://accounts.google.com/o/oauth2/v2/auth?state=abc&client_id=x");
    expect(log.stored).toEqual([cookie]);
  });

  test("a refusal comes back as ?error=CODE and is said in the user's words; nothing is stored", async () => {
    const cases: [string, string][] = [
      ["GOOGLE_NOT_INVITED", "auth.errors.googleNotInvited"],
      ["GOOGLE_NOT_FOR_STAFF", "auth.errors.googleNotForStaff"],
      ["GOOGLE_EMAIL_NOT_VERIFIED", "auth.errors.googleEmailNotVerified"],
      ["access_denied", "auth.errors.signInFailed"],
      ["please_restart_the_process", "auth.errors.signInFailed"],
    ];
    for (const [code, key] of cases) {
      // A refusal may still carry a cookie header (the state cookie cleared); the error wins.
      const { d, log } = deps({ resultUrl: `${RETURN}?error=${code}&cookie=x%3Dy` });
      expect(await googleSignInWith(d)).toEqual({ step: "error", messageKey: key as never });
      expect(log.stored).toEqual([]);
    }
  });

  test("closing the browser is silent", async () => {
    for (const type of ["cancel", "dismiss", "locked"]) {
      const { d, log } = deps({ resultType: type });
      expect(await googleSignInWith(d)).toEqual({ step: "cancelled" });
      expect(log.stored).toEqual([]);
    }
  });

  test("back with neither a session cookie nor an error is a failed sign-in", async () => {
    for (const resultUrl of [RETURN, `${RETURN}?cookie=${encodeURIComponent("__Host-better-auth.state=; Max-Age=0")}`]) {
      const { d, log } = deps({ resultUrl });
      expect(await googleSignInWith(d)).toEqual({ step: "error", messageKey: "auth.errors.signInFailed" });
      expect(log.stored).toEqual([]);
    }
  });

  test("a start the server refuses, or no network, never opens the browser", async () => {
    for (const [error, key] of [
      [{ status: 0 }, "errors.network"],
      [{ status: 429 }, "native.tooManyTries"],
      [{ status: 404, code: "PROVIDER_NOT_FOUND", message: "Provider not found" }, "auth.errors.signInFailed"],
    ] as const) {
      const { d, log } = deps({ start: async () => ({ data: null, error }) });
      expect(await googleSignInWith(d)).toEqual({ step: "error", messageKey: key as never });
      expect(log.opened).toBeUndefined();
    }
    const { d } = deps({
      start: async () => {
        throw new TypeError("Network request failed");
      },
    });
    expect(await googleSignInWith(d)).toEqual({ step: "error", messageKey: "errors.network" });
  });

  test("every refusal key exists in English", () => {
    for (const code of ["GOOGLE_NOT_INVITED", "GOOGLE_NOT_FOR_STAFF", "GOOGLE_EMAIL_NOT_VERIFIED", "anything"]) {
      expect(has(googleReturnErrorKey(code))).toBe(true);
    }
  });
});

describe("the cookie lands where the Expo auth client reads it", () => {
  test("same storage key as @better-auth/expo: `<scheme>_cookie`, colons replaced", () => {
    expect(authCookieStorageKey("orrn")).toBe("orrn_cookie");
    expect(authCookieStorageKey("a:b")).toBe("a_b_cookie");
    // Drift guard: the installed client still names its key this way.
    const req = createRequire(join(ROOT, "package.json"));
    const client = readFileSync(join(dirname(req.resolve("@better-auth/expo/package.json")), "dist", "client.js"), "utf8");
    expect(client).toContain("const cookieName = `${storagePrefix}_cookie`;");
    expect(client).toContain('return name.replace(/:/g, "_");');
  });

  test("the wiring stores with the library's getSetCookie and tells the session store", () => {
    const src = read("lib/auth-client.ts");
    expect(src).toMatch(/getSetCookie/);
    expect(src).toMatch(/\$sessionSignal/);
    expect(src).toMatch(/authCookieStorageKey\(/);
  });

  test("the browser is asked for an ephemeral session, and the binding passes that through", async () => {
    const { d, log } = deps({ resultType: "cancel" });
    await googleSignInWith(d);
    expect(log.options).toEqual({ preferEphemeralSession: true });
    // lib/google-sign-in.ts hands the flow's options to openAuthSessionAsync unchanged.
    expect(read("lib/google-sign-in.ts")).toMatch(/openAuthSessionAsync\(url, returnUrl, options\)/);
  });

  test("a Google sign-in finishes like every other sign-in (plant picker included)", () => {
    expect(read("features/auth/alt-sign-in.tsx")).toMatch(/finish\(\)/);
    expect(read("app/(auth)/sign-in.tsx")).toMatch(/finish=\{/);
    expect(read("app/(auth)/sign-in.tsx")).toMatch(/afterSignIn/);
  });
});
