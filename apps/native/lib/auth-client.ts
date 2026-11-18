import { expoClient, getSetCookie } from "@better-auth/expo/client";
import { env } from "@orrn/env/native";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { authCookieStorageKey } from "./google-flow";
import { REQUEST_TIMEOUT_MS } from "./request-timeout";
import { hasSessionCookie } from "./session-cookie";

const SCHEME = Constants.expoConfig?.scheme as string;

/**
 * Better Auth for native. `expoClient` keeps the session cookie in SecureStore
 * and forwards it by hand (React Native has no cookie jar). `twoFactorClient`
 * adds `twoFactor.verifyTotp`; without it a 2FA account's sign-in "succeeded"
 * with no session (audit N5). The sign-in screen handles the code step itself
 * (it reads `twoFactorRedirect` from the sign-in result), so no redirect
 * callback is registered here. Every call gives up after 10 s (better-fetch's
 * `timeout`), so sign-in and the code step fail with the network message
 * instead of spinning until the OS gives up on a dead uplink. Any browser sign-in the client opens
 * itself is an ephemeral session (floor phones are shared; plan 2026-11-18); Google sign-in runs its
 * own browser step the same way (lib/google-sign-in.ts).
 */
export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_SERVER_URL,
  fetchOptions: { timeout: REQUEST_TIMEOUT_MS },
  plugins: [
    expoClient({
      scheme: SCHEME,
      storagePrefix: SCHEME,
      storage: SecureStore,
      webBrowserOptions: { preferEphemeralSession: true },
    }),
    twoFactorClient(),
  ],
});

/**
 * A session cookie is stored on this device (it may still be expired server-side). Other cookies (a
 * passkey challenge or OAuth state left by a cancelled attempt) do not count (lib/session-cookie.ts).
 */
export function hasStoredSession(): boolean {
  return hasSessionCookie(authClient.getCookie());
}

/** `<server>/api/auth`, where the auth endpoints (and the Expo authorization proxy) live. */
export const AUTH_BASE_URL = `${env.EXPO_PUBLIC_SERVER_URL.replace(/\/+$/, "")}/api/auth`;

/**
 * Stores a Set-Cookie header (the session a Google sign-in came back with) exactly where and how the
 * Expo client keeps its cookies, then tells the session store, as the client's own browser step does.
 */
export function storeAuthCookie(setCookie: string): void {
  const key = authCookieStorageKey(SCHEME);
  SecureStore.setItem(key, getSetCookie(setCookie, SecureStore.getItem(key) ?? undefined));
  authClient.$store.notify("$sessionSignal");
}
