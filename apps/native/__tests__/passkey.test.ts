import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "@orrn/i18n/en";

import { createNativePasskey, needsSignInAgain, PasskeyFailure, passkeyButtonShown, type AuthFetch, type PasskeyModule } from "../lib/passkey-flow";
import { hasSessionCookie } from "../lib/session-cookie";

/**
 * Passkeys on the phone (plan 2026-11-18, Task 6). The phone talks to the same Better Auth passkey
 * endpoints as the web, through the Expo auth client's fetch (it carries the stored cookie, so the
 * challenge cookie set by the options call rides on the verify call), and hands the options to
 * `react-native-passkey`. Device runs are out of scope for this task; these pin the round trip.
 */

const ROOT = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function has(key: string): boolean {
  let node: unknown = en;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)?.[part];
  return typeof node === "string";
}

type Call = { path: string; method: string; query?: Record<string, string>; body?: unknown };

function fakeFetch(answers: Record<string, { data?: unknown; error?: { status?: number; code?: string; message?: string } | null }>) {
  const calls: Call[] = [];
  const fetch: AuthFetch = async (path, opts) => {
    calls.push({ path, method: opts.method, query: opts.query, body: opts.body });
    const answer = answers[path];
    if (!answer) throw new Error(`unexpected call ${path}`);
    return { data: answer.data ?? null, error: answer.error ?? null };
  };
  return { fetch, calls };
}

function fakeModule(over: Partial<PasskeyModule> = {}) {
  const seen: { get?: unknown; create?: unknown } = {};
  const module: PasskeyModule = {
    isSupported: () => true,
    get: async (request) => {
      seen.get = request;
      return {
        id: "cred-1",
        rawId: "cred-1",
        type: "public-key",
        response: { authenticatorData: "ad", clientDataJSON: "cd", signature: "sig", userHandle: "uh" },
        clientExtensionResults: {},
      };
    },
    create: async (request) => {
      seen.create = request;
      return {
        id: "cred-2",
        rawId: "cred-2",
        type: "public-key",
        response: { clientDataJSON: "cd", attestationObject: "ao", transports: ["internal"] },
        clientExtensionResults: {},
      };
    },
    ...over,
  };
  return { module, seen };
}

const AUTH_OPTIONS = {
  challenge: "chal-auth",
  rpId: "orrn.in",
  timeout: 60_000,
  userVerification: "preferred",
  allowCredentials: [],
  extensions: { credProps: true },
};

const REGISTER_OPTIONS = {
  challenge: "chal-reg",
  rp: { name: "ORRN", id: "orrn.in" },
  user: { id: "dXNlcg", name: "dad@plant.test", displayName: "Dad" },
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
  timeout: 60_000,
  excludeCredentials: [{ id: "old", type: "public-key", transports: ["internal"] }],
  authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  attestation: "none",
  extensions: { credProps: true },
};

async function failureOf(promise: Promise<unknown>): Promise<PasskeyFailure> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PasskeyFailure);
    return error as PasskeyFailure;
  }
  throw new Error("expected a PasskeyFailure");
}

describe("unsupported: no passkey button", () => {
  test("a phone that cannot make passkeys says unsupported", async () => {
    const { fetch } = fakeFetch({});
    const { module } = fakeModule({ isSupported: () => false });
    expect(await createNativePasskey({ module, fetch }).supported()).toBe(false);
  });

  test("a build without the native module (Expo Go) says unsupported instead of throwing", async () => {
    const { fetch } = fakeFetch({});
    const { module } = fakeModule({
      isSupported: () => {
        throw new Error("The package 'react-native-passkey' doesn't seem to be linked");
      },
    });
    expect(await createNativePasskey({ module, fetch }).supported()).toBe(false);
  });

  test("the button shows only when the phone can and the server has this platform's association", () => {
    const methods = { google: false, passkey: { rpID: "orrn.in" }, native: { ios: true, android: false } };
    expect(passkeyButtonShown({ deviceSupported: true, methods, platform: "ios" })).toBe(true);
    expect(passkeyButtonShown({ deviceSupported: false, methods, platform: "ios" })).toBe(false);
    expect(passkeyButtonShown({ deviceSupported: true, methods, platform: "android" })).toBe(false);
    expect(passkeyButtonShown({ deviceSupported: true, methods: undefined, platform: "ios" })).toBe(false);
    expect(passkeyButtonShown({ deviceSupported: true, methods: { google: true, passkey: { rpID: "orrn.in" } }, platform: "ios" })).toBe(false);
    expect(passkeyButtonShown({ deviceSupported: true, methods, platform: "web" })).toBe(false);
  });
});

describe("sign in with a passkey", () => {
  test("options round trip: GET options, the module gets them, the assertion is posted to verify", async () => {
    const { fetch, calls } = fakeFetch({
      "/passkey/generate-authenticate-options": { data: AUTH_OPTIONS },
      "/passkey/verify-authentication": { data: { session: { id: "s" }, user: { id: "u" } } },
    });
    const { module, seen } = fakeModule();
    await createNativePasskey({ module, fetch }).signIn();

    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /passkey/generate-authenticate-options", "POST /passkey/verify-authentication"]);
    // The module's own request shape; extensions the module does not know are dropped.
    expect(seen.get).toEqual({ challenge: "chal-auth", rpId: "orrn.in", timeout: 60_000, userVerification: "preferred", allowCredentials: [] });
    expect(calls[1]!.body).toEqual({
      response: {
        id: "cred-1",
        rawId: "cred-1",
        type: "public-key",
        response: { authenticatorData: "ad", clientDataJSON: "cd", signature: "sig", userHandle: "uh" },
      },
    });
  });

  test("an assertion without rawId or type is completed the way the server's verifier needs it", async () => {
    const { fetch, calls } = fakeFetch({
      "/passkey/generate-authenticate-options": { data: AUTH_OPTIONS },
      "/passkey/verify-authentication": { data: { session: { id: "s" } } },
    });
    const { module } = fakeModule({
      get: async () => ({ id: "cred-9", response: { authenticatorData: "ad", clientDataJSON: "cd", signature: "sig" } }),
    });
    await createNativePasskey({ module, fetch }).signIn();
    const body = calls[1]!.body as { response: { id: string; rawId: string; type: string } };
    expect(body.response.rawId).toBe("cred-9");
    expect(body.response.type).toBe("public-key");
  });

  test("closing the Face ID / fingerprint sheet is an inline cancelled message, nothing posted", async () => {
    for (const code of ["UserCancelled", "TimedOut", "Interrupted"]) {
      const { fetch, calls } = fakeFetch({ "/passkey/generate-authenticate-options": { data: AUTH_OPTIONS } });
      const { module } = fakeModule({
        get: async () => {
          throw { error: code, message: "native text that is never shown" };
        },
      });
      const failure = await failureOf(createNativePasskey({ module, fetch }).signIn());
      expect(failure.messageKey).toBe("auth.errors.passkeyCancelled");
      expect(failure.cancelled).toBe(true);
      expect(calls).toHaveLength(1);
    }
  });

  test("no passkey on the phone, or one the server does not know, never reads as a wrong password", async () => {
    const none = fakeFetch({ "/passkey/generate-authenticate-options": { data: AUTH_OPTIONS } });
    const noCred = fakeModule({
      get: async () => {
        throw { error: "NoCredentials", message: "x" };
      },
    });
    expect((await failureOf(createNativePasskey({ module: noCred.module, fetch: none.fetch }).signIn())).messageKey).toBe("auth.errors.passkeyNotFound");

    for (const error of [{ status: 401, code: "PASSKEY_NOT_FOUND" }, { status: 401, code: "AUTHENTICATION_FAILED" }, { status: 401 }]) {
      const { fetch } = fakeFetch({
        "/passkey/generate-authenticate-options": { data: AUTH_OPTIONS },
        "/passkey/verify-authentication": { error },
      });
      const failure = await failureOf(createNativePasskey({ module: fakeModule().module, fetch }).signIn());
      expect(failure.messageKey).toBe("auth.errors.passkeyNotFound");
      expect(failure.cancelled).toBe(false);
    }
  });

  test("network, rate limit and other failures get their own words, never the server's text", async () => {
    const cases: [{ status?: number; code?: string; message?: string }, string][] = [
      [{ status: 0 }, "errors.network"],
      [{ status: 429 }, "native.tooManyTries"],
      [{ status: 500, message: "D1 exploded" }, "auth.errors.signInFailed"],
    ];
    for (const [error, key] of cases) {
      const { fetch } = fakeFetch({ "/passkey/generate-authenticate-options": { error } });
      expect((await failureOf(createNativePasskey({ module: fakeModule().module, fetch }).signIn())).messageKey).toBe(key as never);
    }
    const thrown: AuthFetch = async () => {
      throw new TypeError("Network request failed");
    };
    expect((await failureOf(createNativePasskey({ module: fakeModule().module, fetch: thrown }).signIn())).messageKey).toBe("errors.network");
  });
});

describe("add a passkey (Settings)", () => {
  test("options round trip with the name: GET options with the name, create, POST verify with response and name", async () => {
    const { fetch, calls } = fakeFetch({
      "/passkey/generate-register-options": { data: REGISTER_OPTIONS },
      "/passkey/verify-registration": { data: { id: "pk-1" } },
    });
    const { module, seen } = fakeModule();
    await createNativePasskey({ module, fetch }).add("iPhone");

    expect(calls[0]).toEqual({ path: "/passkey/generate-register-options", method: "GET", query: { name: "iPhone" }, body: undefined });
    const { extensions: _dropped, ...expected } = REGISTER_OPTIONS;
    expect(seen.create).toEqual(expected);
    expect(calls[1]).toEqual({
      path: "/passkey/verify-registration",
      method: "POST",
      query: undefined,
      body: {
        name: "iPhone",
        response: { id: "cred-2", rawId: "cred-2", type: "public-key", response: { clientDataJSON: "cd", attestationObject: "ao", transports: ["internal"] } },
      },
    });
  });

  test("an old phone session asks to sign in again before any OS sheet opens", async () => {
    const { fetch } = fakeFetch({ "/passkey/generate-register-options": { error: { status: 403, code: "SESSION_NOT_FRESH" } } });
    let opened = false;
    const { module } = fakeModule({
      create: async () => {
        opened = true;
        return {};
      },
    });
    const failure = await failureOf(createNativePasskey({ module, fetch }).add("Android"));
    expect(failure.messageKey).toBe("auth.errors.signInAgain");
    expect(opened).toBe(false);
    // Settings then offers "Sign in again" (the usual sign-out to the sign-in screen).
    expect(needsSignInAgain(failure)).toBe(true);
  });

  test("only a stale session offers 'Sign in again'", () => {
    for (const key of ["auth.errors.passkeyAddFailed", "auth.errors.passkeyAddCancelled", "errors.network"] as const) {
      expect(needsSignInAgain(new PasskeyFailure(key))).toBe(false);
    }
  });

  test("Settings wires 'Sign in again' to the existing sign-out flow", () => {
    const src = read("features/settings/passkeys.tsx");
    expect(src).toMatch(/setOfferSignIn\(needsSignInAgain\(failure\)\)/);
    expect(src).toMatch(/settings\.signIn\.signInAgain/);
    expect(src).toMatch(/void signOut\(\)/);
  });

  test("cancel, a passkey already on this phone, and other failures", async () => {
    const cases: [unknown, string, boolean][] = [
      [{ error: "UserCancelled", message: "x" }, "auth.errors.passkeyAddCancelled", true],
      [{ error: "CredentialAlreadyExists", message: "x" }, "auth.errors.passkeyExists", false],
      [{ error: "BadConfiguration", message: "RP ID cannot be validated." }, "auth.errors.passkeyAddFailed", false],
      [new Error("boom"), "auth.errors.passkeyAddFailed", false],
    ];
    for (const [thrown, key, cancelled] of cases) {
      const { fetch } = fakeFetch({ "/passkey/generate-register-options": { data: REGISTER_OPTIONS } });
      const { module } = fakeModule({
        create: async () => {
          throw thrown;
        },
      });
      const failure = await failureOf(createNativePasskey({ module, fetch }).add("iPhone"));
      expect(failure.messageKey).toBe(key as never);
      expect(failure.cancelled).toBe(cancelled);
    }
  });

  test("a refused verify is a failed add, never the server's words", async () => {
    const { fetch } = fakeFetch({
      "/passkey/generate-register-options": { data: REGISTER_OPTIONS },
      "/passkey/verify-registration": { error: { status: 400, message: "Failed to verify registration" } },
    });
    expect((await failureOf(createNativePasskey({ module: fakeModule().module, fetch }).add("iPhone"))).messageKey).toBe("auth.errors.passkeyAddFailed");
  });
});

describe("every message the phone shows exists", () => {
  test("keys are in the English dictionary", () => {
    const src = read("lib/passkey-flow.ts");
    const keys = [...src.matchAll(/"((?:auth|errors|native)\.[A-Za-z.]+)"/g)].map((m) => m[1]!);
    expect(keys.length).toBeGreaterThan(5);
    for (const key of keys) expect({ key, ok: has(key) }).toEqual({ key, ok: true });
  });
});

describe("wiring", () => {
  test("lib/passkey.ts binds react-native-passkey and the Expo auth client's fetch", () => {
    const src = read("lib/passkey.ts");
    expect(src).toMatch(/from "react-native-passkey"/);
    expect(src).toMatch(/authClient\.\$fetch/);
    expect(src).toMatch(/export const nativePasskey/);
  });

  test("adding a passkey asks 'Is this your own phone?' first, and only Settings adds one", () => {
    const settings = read("app/more/settings.tsx") + read("features/settings/passkeys.tsx");
    expect(settings).toMatch(/native\.passkey\.ownPhoneTitle/);
    expect(settings).toMatch(/native\.passkey\.ownPhoneBody/);
    // The sign-in screen never offers to add one.
    expect(read("app/(auth)/sign-in.tsx")).not.toMatch(/\.add\(/);
    expect(read("features/auth/alt-sign-in.tsx")).not.toMatch(/\.add\(/);
  });
});

describe("iOS associated domain (config plugin)", () => {
  const plugin = require("../plugins/with-passkey-domains.js") as {
    passkeyDomain(env: Record<string, string | undefined>): string;
    addPasskeyDomain(entitlements: Record<string, unknown>, domain: string): Record<string, unknown>;
  };

  test("app.json runs it", () => {
    const app = JSON.parse(read("app.json"));
    expect(app.expo.plugins).toContain("./plugins/with-passkey-domains");
  });

  test("webcredentials for the relying party, orrn.in unless ORRN_PASSKEY_RP_ID says otherwise", () => {
    expect(plugin.passkeyDomain({})).toBe("webcredentials:orrn.in");
    expect(plugin.passkeyDomain({ ORRN_PASSKEY_RP_ID: "dev.orrn.app" })).toBe("webcredentials:dev.orrn.app");
    expect(plugin.passkeyDomain({ ORRN_PASSKEY_RP_ID: "  " })).toBe("webcredentials:orrn.in");
  });

  test("the entitlement is added once and keeps domains already there", () => {
    const key = "com.apple.developer.associated-domains";
    expect(plugin.addPasskeyDomain({}, "webcredentials:orrn.in")).toEqual({ [key]: ["webcredentials:orrn.in"] });
    const twice = plugin.addPasskeyDomain(plugin.addPasskeyDomain({ [key]: ["applinks:orrn.in"] }, "webcredentials:orrn.in"), "webcredentials:orrn.in");
    expect(twice).toEqual({ [key]: ["applinks:orrn.in", "webcredentials:orrn.in"] });
  });
});

describe("a cancelled attempt does not look like a sign-in", () => {
  test("only a session cookie counts as a stored session", () => {
    expect(hasSessionCookie("")).toBe(false);
    // What a cancelled passkey or Google attempt leaves behind.
    expect(hasSessionCookie("__Host-better-auth.better-auth-passkey=abc")).toBe(false);
    expect(hasSessionCookie("__Host-better-auth.state=xyz; __Host-better-auth.better-auth-passkey=abc")).toBe(false);
    expect(hasSessionCookie("__Host-better-auth.state=xyz; __Host-better-auth.session_token=tok")).toBe(true);
    expect(hasSessionCookie("better-auth.session_token=tok")).toBe(true);
  });

  test("the session gate reads it", () => {
    expect(read("lib/auth-client.ts")).toMatch(/return hasSessionCookie\(authClient\.getCookie\(\)\)/);
  });
});
