import { clearDraft } from "../../features/pack/use-pack-draft";
import { clearImpersonation } from "./impersonation";
import { authClient } from "./auth-client";
import { queryClient } from "../utils/trpc";

/**
 * Every sign-out path: end the Better Auth session, forget any impersonation
 * grant (it would otherwise survive in sessionStorage and make the next user's
 * calls FORBIDDEN), forget an unsaved packing session (typed bundles belong to the person who typed
 * them, not to the next person at a shared station), and drop all cached data before leaving.
 */
export async function signOutAndReset(onDone: () => void) {
  clearImpersonation();
  clearPackDraft();
  await authClient.signOut({
    fetchOptions: {
      onSuccess: () => {
        clearImpersonation();
        clearPackDraft();
        queryClient.clear();
        onDone();
      },
    },
  });
}

/** `sessionStorage` where reading it is allowed; the pack draft lives there (features/pack/use-pack-draft.ts). */
function clearPackDraft() {
  try {
    clearDraft(typeof window === "undefined" ? null : window.sessionStorage);
  } catch {
    // Blocked storage holds no draft to clear.
  }
}
