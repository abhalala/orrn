import { Passkey } from "react-native-passkey";

import { authClient } from "./auth-client";
import { createNativePasskey, type AuthFetch, type NativePasskey, type PasskeyModule } from "./passkey-flow";

export { needsSignInAgain, PasskeyFailure, passkeyButtonShown } from "./passkey-flow";

/**
 * Passkeys on this phone (plan 2026-11-18, Task 6): `react-native-passkey` makes and uses them, and
 * the Expo auth client's fetch talks to the server (it stores the challenge cookie and sends it back,
 * with the session cookie when adding one). The steps and their tests are in lib/passkey-flow.ts.
 */
export const nativePasskey: NativePasskey = createNativePasskey({
  module: Passkey as unknown as PasskeyModule,
  fetch: ((path, opts) => authClient.$fetch(path, opts)) as AuthFetch,
});
