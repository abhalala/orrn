import { clearDraft } from "../../features/pack/use-pack-draft";
import { beginSessionChange, cancelSessionChange, warnLeaving } from "../../features/press/outbox-session";
import { clearImpersonation } from "./impersonation";
import { authClient } from "./auth-client";
import { queryClient } from "../utils/trpc";

/**
 * Every sign-out path: end the Better Auth session, forget any impersonation
 * grant (it would otherwise survive in sessionStorage and make the next user's
 * calls FORBIDDEN), forget an unsaved packing session (typed bundles belong to the person who typed
 * them, not to the next person at a shared station), and drop all cached data before leaving.
 *
 * Press changes still waiting in the outbox are NOT sent and NOT thrown away: the person is told how
 * many are waiting, any send in flight is aborted, and the list stays under their own key until they
 * sign in again (FP-PR-19: never sent as the next person).
 */
export async function signOutAndReset(onDone: () => void) {
  warnLeaving("signOut");
  beginSessionChange();
  clearImpersonation();
  clearPackDraft();
  let signedOut = false;
  try {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          signedOut = true;
          clearImpersonation();
          clearPackDraft();
          queryClient.clear();
          onDone();
        },
      },
    });
  } finally {
    // The sign-out did not go through: the same person carries on, and their list may be sent again.
    if (!signedOut) cancelSessionChange();
  }
}

/** `sessionStorage` where reading it is allowed; the pack draft lives there (features/pack/use-pack-draft.ts). */
function clearPackDraft() {
  try {
    clearDraft(typeof window === "undefined" ? null : window.sessionStorage);
  } catch {
    // Blocked storage holds no draft to clear.
  }
}
