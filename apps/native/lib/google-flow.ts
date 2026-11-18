import type { MessageKey } from "@orrn/i18n";

/**
 * "Continue with Google" on the phone (plan 2026-11-18, Task 6), with its dependencies passed in so bun
 * tests it (lib/google-sign-in.ts binds the real auth client, browser and storage). No React Native imports.
 *
 * Why the phone runs the browser step itself: `@better-auth/expo`'s client opens the browser inside a
 * fetch hook and returns nothing from it, so a refusal that comes back as `?error=CODE` never reaches the
 * screen. Here, the start call asks for no redirect, the phone opens the server's Expo proxy (it sets the
 * OAuth state cookie inside the browser, then goes to Google), and reads the deep link it comes back on:
 * - `?error=CODE`: a refusal (`google-guard.ts`: not invited, staff, unverified email) or an OAuth error;
 * - `?cookie=...`: the server's Expo plugin put the session's Set-Cookie there; it is stored the way the
 *   Expo client stores cookies, and the screen runs the usual sign-in finish.
 * Success and refusal come back on ONE deep link: Android's auth session matches the return by prefix.
 */

type AuthError = { status?: number; code?: string; message?: string } | null | undefined;

export type GoogleOutcome = { step: "done" } | { step: "cancelled" } | { step: "error"; messageKey: MessageKey };

export type GoogleStartBody = { provider: "google"; callbackURL: string; errorCallbackURL: string; disableRedirect: true };

export type GoogleDeps = {
  /** `authClient.signIn.social`. */
  start(body: GoogleStartBody): Promise<{ data?: unknown; error?: AuthError }>;
  /** `WebBrowser.openAuthSessionAsync` in an ephemeral session. */
  openAuthSession(url: string, returnUrl: string): Promise<{ type: string; url?: string }>;
  /** Stores a Set-Cookie header the way the Expo client does, and tells the session store. */
  storeCookie(setCookie: string): void;
  /** The app's deep link Google's sign-in comes back on (`orrn:///` in a build). */
  returnUrl: string;
  /** `<server>/api/auth`. */
  authBaseUrl: string;
};

/** Google refusals with their own words (`packages/auth/src/google-guard.ts`); every other code is a failed sign-in. */
const REFUSALS: Record<string, MessageKey> = {
  GOOGLE_NOT_INVITED: "auth.errors.googleNotInvited",
  GOOGLE_NOT_FOR_STAFF: "auth.errors.googleNotForStaff",
  GOOGLE_EMAIL_NOT_VERIFIED: "auth.errors.googleEmailNotVerified",
};

/** The words for `?error=CODE` on the return link. The code's own text is never shown. */
export function googleReturnErrorKey(code: string): MessageKey {
  return REFUSALS[code] ?? "auth.errors.signInFailed";
}

function startErrorKey(error: NonNullable<AuthError>): MessageKey {
  // better-fetch reports a request that got no answer (no connection, DNS, timeout) as status 0.
  if (!error.status) return "errors.network";
  if (error.status === 429 || error.code?.startsWith("TOO_MANY")) return "native.tooManyTries";
  return "auth.errors.signInFailed";
}

/**
 * Where `@better-auth/expo` keeps the cookie jar: `<storagePrefix>_cookie`, with colons replaced
 * (SecureStore refuses them). `__tests__/google-sign-in.test.ts` checks the installed client still does.
 */
export function authCookieStorageKey(storagePrefix: string): string {
  return `${storagePrefix}_cookie`.replace(/:/g, "_");
}

/** Reads one query value from a deep link such as `orrn:///?error=X` or `exp://host/--/?cookie=Y`. */
function param(url: string, name: string): string | null {
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1).split("#")[0]! : "";
  return new URLSearchParams(query).get(name);
}

export async function googleSignInWith(deps: GoogleDeps): Promise<GoogleOutcome> {
  let authorizationUrl: string | undefined;
  try {
    const { data, error } = await deps.start({
      provider: "google",
      callbackURL: deps.returnUrl,
      errorCallbackURL: deps.returnUrl,
      disableRedirect: true,
    });
    if (error) return { step: "error", messageKey: startErrorKey(error) };
    const url = (data as { url?: unknown } | null | undefined)?.url;
    authorizationUrl = typeof url === "string" ? url : undefined;
  } catch (thrown) {
    return { step: "error", messageKey: thrown instanceof TypeError ? "errors.network" : "auth.errors.signInFailed" };
  }
  if (!authorizationUrl) return { step: "error", messageKey: "auth.errors.signInFailed" };

  const proxy = `${deps.authBaseUrl}/expo-authorization-proxy?${new URLSearchParams({ authorizationURL: authorizationUrl }).toString()}`;
  let result: { type: string; url?: string };
  try {
    result = await deps.openAuthSession(proxy, deps.returnUrl);
  } catch {
    return { step: "error", messageKey: "auth.errors.signInFailed" };
  }
  // Closed by the person (cancel), dismissed, or another session holds the browser: nothing to say.
  if (result.type !== "success" || !result.url) return { step: "cancelled" };

  const refusal = param(result.url, "error");
  if (refusal) return { step: "error", messageKey: googleReturnErrorKey(refusal) };
  const cookie = param(result.url, "cookie");
  // Only a session cookie signs in; anything else (a cleared state cookie) is a sign-in that did not finish.
  if (!cookie || !cookie.includes("session_token")) return { step: "error", messageKey: "auth.errors.signInFailed" };
  deps.storeCookie(cookie);
  return { step: "done" };
}
