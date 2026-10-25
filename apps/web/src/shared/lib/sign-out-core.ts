import { clearDraft } from "../../features/pack/use-pack-draft";
import { beginSessionChange, cancelSessionChange, warnLeaving } from "../../features/press/outbox-session";
import { clearImpersonation } from "./impersonation";

/**
 * The steps of every sign-out, without the browser's auth client and query cache (they are passed
 * in by `sign-out.ts`, so the order of steps is testable): end the Better Auth session, forget any
 * impersonation grant (it would otherwise survive in sessionStorage and make the next user's calls
 * FORBIDDEN), forget an unsaved packing session (typed bundles belong to the person who typed them,
 * not to the next person at a shared station), and drop all cached data before leaving.
 *
 * Press changes still waiting in the outbox are NOT sent and NOT thrown away: the person is told how
 * many are waiting, any send in flight is aborted, and the list stays under their own key until they
 * sign in again (FP-PR-19: never sent as the next person).
 */
export type SignOutResult = "signed_out" | "offline" | "failed";

/** What the screen says when the sign-out did not happen (M2, final explore). */
export const SIGN_OUT_REFUSAL = { offline: "nav.signOutOffline", failed: "nav.signOutFailed" } as const;

export const browserOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

/** The two calls a sign-out makes outside this file (injected so the order of steps can be tested). */
export type SignOutDeps = {
  endSession(onSuccess: () => void): Promise<unknown>;
  clearCache(): void;
};

export async function signOutAndResetWith(onDone: () => void, online: () => boolean, deps: SignOutDeps): Promise<SignOutResult> {
  // M2 (final explore): offline nothing can end the session on the server, so nothing is ended here
  // either (a shared tablet must not look signed out while the session lives on). The caller says
  // so; press changes still waiting are counted with words that do not promise a sign-in.
  if (!online()) {
    warnLeaving("offline");
    return "offline";
  }
  warnLeaving("signOut");
  beginSessionChange();
  clearImpersonation();
  clearPackDraft();
  let signedOut = false;
  try {
    await deps.endSession(() => {
      signedOut = true;
      clearImpersonation();
      clearPackDraft();
      deps.clearCache();
      onDone();
    });
  } catch {
    // The request never reached the server (the link dropped mid-way): reported below as failed.
  } finally {
    // The sign-out did not go through: the same person carries on, and their list may be sent again.
    if (!signedOut) cancelSessionChange();
  }
  return signedOut ? "signed_out" : "failed";
}

/** `sessionStorage` where reading it is allowed; the pack draft lives there (features/pack/use-pack-draft.ts). */
function clearPackDraft() {
  try {
    clearDraft(typeof window === "undefined" ? null : window.sessionStorage);
  } catch {
    // Blocked storage holds no draft to clear.
  }
}
