import { expoClient } from "@better-auth/expo/client";
import { env } from "@orrn/env/native";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

import { REQUEST_TIMEOUT_MS } from "./request-timeout";

/**
 * Better Auth for native. `expoClient` keeps the session cookie in SecureStore
 * and forwards it by hand (React Native has no cookie jar). `twoFactorClient`
 * adds `twoFactor.verifyTotp`; without it a 2FA account's sign-in "succeeded"
 * with no session (audit N5). The sign-in screen handles the code step itself
 * (it reads `twoFactorRedirect` from the sign-in result), so no redirect
 * callback is registered here. Every call gives up after 10 s (better-fetch's
 * `timeout`), so sign-in and the code step fail with the network message
 * instead of spinning until the OS gives up on a dead uplink.
 */
export const authClient = createAuthClient({
  baseURL: env.EXPO_PUBLIC_SERVER_URL,
  fetchOptions: { timeout: REQUEST_TIMEOUT_MS },
  plugins: [
    expoClient({
      scheme: Constants.expoConfig?.scheme as string,
      storagePrefix: Constants.expoConfig?.scheme as string,
      storage: SecureStore,
    }),
    twoFactorClient(),
  ],
});

/** A session cookie is stored on this device (it may still be expired server-side). */
export function hasStoredSession(): boolean {
  return authClient.getCookie().length > 0;
}
