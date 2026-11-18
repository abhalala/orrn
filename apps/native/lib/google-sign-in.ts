import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import { AUTH_BASE_URL, authClient, storeAuthCookie } from "./auth-client";
import { googleSignInWith, type GoogleOutcome } from "./google-flow";

/**
 * "Continue with Google" (lib/google-flow.ts has the steps and the tests). The browser is an ephemeral
 * session on iOS, so no Google login stays behind on a shared floor phone. Android opens a Custom Tab,
 * which has no such switch in expo-web-browser; the server asks Google to show the account picker every
 * time (`prompt: "select_account"`), so the next person is never signed in as the last one silently.
 */
export function signInWithGoogle(): Promise<GoogleOutcome> {
  return googleSignInWith({
    start: (body) => authClient.signIn.social(body),
    openAuthSession: async (url, returnUrl) => {
      // A Custom Tab left open by an earlier attempt would block this one (the Expo client does the same).
      if (Platform.OS === "android") {
        try {
          WebBrowser.dismissAuthSession();
        } catch {
          // Nothing was open.
        }
      }
      return WebBrowser.openAuthSessionAsync(url, returnUrl, { preferEphemeralSession: true });
    },
    storeCookie: storeAuthCookie,
    returnUrl: Linking.createURL("/"),
    authBaseUrl: AUTH_BASE_URL,
  });
}
