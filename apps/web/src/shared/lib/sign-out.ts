import { authClient } from "./auth-client";
import { browserOnline, signOutAndResetWith, type SignOutResult } from "./sign-out-core";
import { queryClient } from "../utils/trpc";

export { SIGN_OUT_REFUSAL, type SignOutResult } from "./sign-out-core";

/** Every sign-out path (see `sign-out-core.ts` for the steps), with the browser's auth client and cache. */
export function signOutAndReset(onDone: () => void): Promise<SignOutResult> {
  return signOutAndResetWith(onDone, browserOnline, {
    endSession: (onSuccess) => authClient.signOut({ fetchOptions: { onSuccess } }),
    clearCache: () => queryClient.clear(),
  });
}
