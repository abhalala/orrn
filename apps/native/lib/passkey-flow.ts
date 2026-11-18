import type { MessageKey } from "@orrn/i18n";

/**
 * Passkeys on the phone (plan 2026-11-18, Task 6), with the native module and the auth client's fetch
 * passed in so bun tests the round trip (lib/passkey.ts binds the real ones). No React Native imports.
 *
 * The same Better Auth passkey endpoints as the web: the options call sets a short-lived challenge
 * cookie, the Expo client stores it like the session cookie and sends it with the verify call. The
 * relying party is the web host (`orrn.in`); the apps prove they belong to it through the
 * `/.well-known` files and the iOS associated domain. Nothing here logs a credential id or a key.
 */

type AuthError = { status?: number; code?: string; message?: string } | null | undefined;

/** `authClient.$fetch` with `throw: false`, narrowed to what this file uses. */
export type AuthFetch = (
  path: string,
  opts: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown; throw: false },
) => Promise<{ data: unknown; error: AuthError }>;

/** `react-native-passkey`'s `Passkey`, narrowed. It throws plain `{ error, message }` objects. */
export type PasskeyModule = {
  isSupported(): boolean;
  get(request: never): Promise<unknown>;
  create(request: never): Promise<unknown>;
};

export type NativePasskey = {
  /** The phone can make and use passkeys (iOS 15+, Android 9+, and a build with the module). */
  supported(): Promise<boolean>;
  /** Signs in with a passkey on this phone. Rejects with a `PasskeyFailure`. */
  signIn(): Promise<void>;
  /** Adds a passkey for the signed-in person (Settings only, after "Is this your own phone?"). Rejects with a `PasskeyFailure`. */
  add(name: string): Promise<void>;
};

/** Why a passkey step did not finish, as words for the screen. `cancelled`: the person closed the sheet. */
export class PasskeyFailure extends Error {
  constructor(
    readonly messageKey: MessageKey,
    readonly cancelled = false,
  ) {
    super(messageKey);
    this.name = "PasskeyFailure";
  }
}

/** What `auth.methods` says (the public read the sign-in screen already makes). */
export type AuthMethods = { google: boolean; passkey: { rpID: string }; native?: { ios: boolean; android: boolean } };

/**
 * Whether the phone shows "Sign in with a passkey" (and Settings offers to add one): the phone can do
 * it AND this stage has the platform's association (`auth.methods.native`). Until the owner gives the
 * Apple Team ID or the Android certificate, that platform shows no passkey button (no broken button).
 */
export function passkeyButtonShown({
  deviceSupported,
  methods,
  platform,
}: {
  deviceSupported: boolean;
  methods: AuthMethods | undefined;
  platform: string;
}): boolean {
  if (!deviceSupported || !methods?.native) return false;
  if (platform === "ios") return methods.native.ios === true;
  if (platform === "android") return methods.native.android === true;
  return false;
}

type Mode = "signIn" | "add";
const CANCELLED = new Set(["UserCancelled", "TimedOut", "Interrupted"]);

/** A failure thrown by the native module (`{ error, message }`) or anything else thrown around it. */
function moduleFailure(thrown: unknown, mode: Mode): PasskeyFailure {
  const code = thrown && typeof thrown === "object" ? (thrown as { error?: unknown }).error : undefined;
  if (typeof code === "string" && CANCELLED.has(code)) {
    return new PasskeyFailure(mode === "signIn" ? "auth.errors.passkeyCancelled" : "auth.errors.passkeyAddCancelled", true);
  }
  if (mode === "signIn") return new PasskeyFailure(code === "NoCredentials" ? "auth.errors.passkeyNotFound" : "auth.errors.signInFailed");
  return new PasskeyFailure(code === "CredentialAlreadyExists" ? "auth.errors.passkeyExists" : "auth.errors.passkeyAddFailed");
}

/** A failure the server answered (or a request that never got an answer). Server text is never shown. */
function serverFailure(error: AuthError, mode: Mode): PasskeyFailure {
  const status = error?.status;
  const code = error?.code ?? "";
  // better-fetch reports a request that got no answer (no connection, DNS, timeout) as status 0.
  if (!status) return new PasskeyFailure("errors.network");
  if (status === 429 || code.startsWith("TOO_MANY")) return new PasskeyFailure("native.tooManyTries");
  if (mode === "add") {
    // Adding one needs a session younger than a day (the plugin's fresh-session rule); phone sessions live longer.
    if (code === "SESSION_NOT_FRESH") return new PasskeyFailure("auth.errors.signInAgain");
    return new PasskeyFailure("auth.errors.passkeyAddFailed");
  }
  // An unknown or unverifiable passkey (status 401) must not read as a wrong password.
  if (status === 401 || code === "PASSKEY_NOT_FOUND" || code === "AUTHENTICATION_FAILED") return new PasskeyFailure("auth.errors.passkeyNotFound");
  return new PasskeyFailure("auth.errors.signInFailed");
}

/** A thrown fetch (React Native throws a TypeError for a dead network). */
function thrownFailure(thrown: unknown, mode: Mode): PasskeyFailure {
  if (thrown instanceof PasskeyFailure) return thrown;
  if (thrown instanceof TypeError) return new PasskeyFailure("errors.network");
  return new PasskeyFailure(mode === "signIn" ? "auth.errors.signInFailed" : "auth.errors.passkeyAddFailed");
}

type Json = Record<string, unknown>;
const record = (value: unknown): Json => (value && typeof value === "object" ? (value as Json) : {});

/** The module's request from the server's options. Extensions are dropped: the module knows only a few, and the server needs none. */
function withoutExtensions(options: unknown): Json {
  const { extensions: _extensions, ...rest } = record(options);
  return rest;
}

/**
 * What the server's verifier (`@simplewebauthn/server`) needs: `id`, `rawId` equal to it and
 * `type: "public-key"`. The module types `rawId` and `type` as optional, so they are filled in here.
 * `clientExtensionResults` stays on the phone, as the web client leaves it out too.
 */
function credentialBody(result: unknown): Json {
  const { clientExtensionResults: _results, ...rest } = record(result);
  const id = typeof rest.id === "string" ? rest.id : "";
  return { ...rest, id, rawId: typeof rest.rawId === "string" && rest.rawId ? rest.rawId : id, type: "public-key" };
}

export function createNativePasskey({ module, fetch }: { module: PasskeyModule; fetch: AuthFetch }): NativePasskey {
  async function call(path: string, mode: Mode, opts: { method: "GET" | "POST"; query?: Record<string, string>; body?: unknown }) {
    let answer: Awaited<ReturnType<AuthFetch>>;
    try {
      answer = await fetch(path, { ...opts, throw: false });
    } catch (thrown) {
      throw thrownFailure(thrown, mode);
    }
    if (answer.error || !answer.data) throw serverFailure(answer.error ?? { status: 500 }, mode);
    return answer.data;
  }

  async function native<T>(run: () => Promise<T>, mode: Mode): Promise<T> {
    try {
      return await run();
    } catch (thrown) {
      throw moduleFailure(thrown, mode);
    }
  }

  return {
    async supported() {
      try {
        return module.isSupported() === true;
      } catch {
        // A build without the native module (Expo Go) cannot make passkeys.
        return false;
      }
    },

    async signIn() {
      const options = await call("/passkey/generate-authenticate-options", "signIn", { method: "GET" });
      const assertion = await native(() => module.get(withoutExtensions(options) as never), "signIn");
      await call("/passkey/verify-authentication", "signIn", { method: "POST", body: { response: credentialBody(assertion) } });
    },

    async add(name) {
      const options = await call("/passkey/generate-register-options", "add", { method: "GET", query: { name } });
      const attestation = await native(() => module.create(withoutExtensions(options) as never), "add");
      await call("/passkey/verify-registration", "add", { method: "POST", body: { response: credentialBody(attestation), name } });
    },
  };
}
