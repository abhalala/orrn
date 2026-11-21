import { APIError } from "better-auth/api";

/**
 * Council round 1, A5: `@better-auth/expo`'s `/expo-authorization-proxy` (GET) redirects to whatever
 * `authorizationURL` it is given and sets the OAuth state cookie from it; with `oauthState` it sets the
 * `oauth_state` cookie straight from the URL. Unguarded that is an open redirect on the API's own domain
 * and a way to plant a state cookie in someone's browser.
 *
 * ORRN's only provider is Google, and the native app (`apps/native/lib/google-flow.ts`) sends only
 * `authorizationURL`, the URL Better Auth's own `/sign-in/social` answered. So the proxy follows only
 * an `https://accounts.google.com` URL (exact origin: no other host, port or scheme, no user info), and
 * refuses `oauthState` outright. Runs in the auth `hooks.before`.
 */
export const EXPO_PROXY_PATH = "/expo-authorization-proxy";
export const EXPO_PROXY_REFUSED = "EXPO_PROXY_REFUSED";
const GOOGLE_AUTHORIZATION_ORIGIN = "https://accounts.google.com";

function refuse(): never {
  throw new APIError("BAD_REQUEST", { code: EXPO_PROXY_REFUSED, message: "This sign-in link is not valid. Start again from the app." });
}

/** True for an authorization URL the proxy may follow. */
export function isGoogleAuthorizationUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.origin === GOOGLE_AUTHORIZATION_ORIGIN && !url.username && !url.password;
}

export function expoProxyGuard(ctx: { path?: string; query?: unknown }): void {
  if (ctx.path !== EXPO_PROXY_PATH) return;
  const query = (ctx.query ?? {}) as { authorizationURL?: unknown; oauthState?: unknown };
  if (query.oauthState !== undefined) refuse();
  if (!isGoogleAuthorizationUrl(query.authorizationURL)) refuse();
}
