import { meQueryOptions } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

import { authClient } from "./auth-client";
import { resetAfterSignOut, resetTenantQueries } from "./session";
import { sessionPresence } from "./session-presence";

/**
 * Every sign-out path. The Expo plugin wipes the stored cookie before the
 * request goes out, so this signs out locally even with no network. The gate
 * flips to sign-in first (no cookie), then every cached query is reset so
 * nothing from this person is left for the next one (AGENTS.md, audit N10).
 */
export async function signOut(): Promise<void> {
  try {
    await authClient.signOut();
  } catch {
    // Offline: the cookie is already gone locally.
  }
  sessionPresence.changed();
  await resetAfterSignOut(queryClient);
}

/**
 * After a successful sign-in (password or TOTP): drop anything cached for a
 * previous person, load `auth.me` with the new cookie, and only then tell the
 * gate, so it moves straight to the right screens with no loading flash.
 */
export async function afterSignIn(): Promise<void> {
  await resetTenantQueries(queryClient);
  try {
    await queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0, retry: false });
  } catch {
    // The gate shows its offline screen and retries from there.
  }
  sessionPresence.changed();
}
