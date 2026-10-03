import { clearImpersonation } from "./impersonation";
import { authClient } from "./auth-client";
import { queryClient } from "../utils/trpc";

/**
 * Every sign-out path: end the Better Auth session, forget any impersonation
 * grant (it would otherwise survive in sessionStorage and make the next user's
 * calls FORBIDDEN), and drop all cached data before leaving.
 */
export async function signOutAndReset(onDone: () => void) {
  clearImpersonation();
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        clearImpersonation();
        queryClient.clear();
        onDone();
      },
    },
  });
}
