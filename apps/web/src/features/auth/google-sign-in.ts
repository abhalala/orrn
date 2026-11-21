import { clearImpersonation } from "@/shared/lib/impersonation";
import { clearPlantChosen } from "@/shared/lib/plant-chosen";
import { safeNext } from "@/shared/lib/safe-next";

import type { AuthClientError } from "./auth-errors";

/** `/login?via=google`: the sign-in page runs the usual finish (`useFinishSignIn`) when Google sends the person back. */
export const GOOGLE_RETURN = "google";

/**
 * Where Google sends the person back (plan 2026-11-18). Success lands on the sign-in page with
 * `via=google`, which runs the same finish as every other sign-in (fresh `auth.me`, then Today, the
 * plant picker, /welcome or the `next` they signed in for). A refusal lands on the sign-in page with
 * `?error=CODE` (google-guard.ts adds it). Absolute URLs on the web origin: the API host runs the
 * callback, and Better Auth accepts only trusted origins. Only a safe same-origin `next` rides along.
 */
export function googleSignInUrls(origin: string, next?: string): { callbackURL: string; errorCallbackURL: string } {
  const kept = safeNext(next, "");
  const callback = new URL("/login", origin);
  callback.searchParams.set("via", GOOGLE_RETURN);
  const error = new URL("/login", origin);
  if (kept) {
    callback.searchParams.set("next", kept);
    error.searchParams.set("next", kept);
  }
  return { callbackURL: callback.toString(), errorCallbackURL: error.toString() };
}

type SocialBody = { provider: "google"; callbackURL: string; errorCallbackURL: string };
type SocialSignIn = (body: SocialBody) => Promise<{ data: unknown; error: AuthClientError }>;

/**
 * Starts "Continue with Google". Before the browser leaves, this tab forgets any plant picked and any
 * impersonation grant from before, as `useFinishSignIn` does for the other ways in, so a person in
 * several plants lands on "Choose a plant" (Task 9) even if the return trip never reaches the finish.
 * On success Better Auth's client moves the page to Google; a start that fails comes back to show.
 */
export async function startGoogleSignIn(
  signIn: SocialSignIn,
  opts: { origin: string; next?: string; storage?: Parameters<typeof clearPlantChosen>[0] },
): Promise<AuthClientError | null> {
  clearImpersonation();
  clearPlantChosen(opts.storage);
  try {
    const { error } = await signIn({ provider: "google", ...googleSignInUrls(opts.origin, opts.next) });
    return error ?? null;
  } catch (error) {
    return error as Error;
  }
}
