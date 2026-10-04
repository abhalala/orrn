import type { QueryClient } from "@tanstack/react-query";

import { resetAfterSignOut, resetTenantQueries } from "./session";

/**
 * Sign-in and sign-out sequencing with its dependencies passed in, so bun can
 * test the order (lib/sign-out.ts wires the real Better Auth client, session
 * presence and QueryClient). No React Native imports.
 */

/**
 * How long sign-out waits for the server before moving on. The Expo plugin
 * wipes the stored cookie before the request leaves, so the person is signed
 * out on this phone either way; waiting longer on Wi-Fi with no uplink would
 * leave the previous person's screens up behind the spinner.
 */
export const SIGN_OUT_WAIT_MS = 1_500;

type Presence = { changed(): void };

export type SignOutDeps = {
  /** Starts the Better Auth sign-out (wipes the cookie locally, then tells the server). */
  authSignOut: () => Promise<unknown>;
  presence: Presence;
  queryClient: QueryClient;
  waitMs?: number;
};

/**
 * Every sign-out path, in this order: the cookie is gone (inside the Expo
 * plugin, before the request), the gate flips to sign-in (the tabs unmount),
 * then every cached query is reset so nothing from this person is left for
 * the next one (AGENTS.md, audit N10). The server call gets `waitMs` to finish;
 * it keeps running in the background after that.
 */
export async function signOutWith({ authSignOut, presence, queryClient, waitMs = SIGN_OUT_WAIT_MS }: SignOutDeps): Promise<void> {
  let request: Promise<unknown>;
  try {
    // Offline or failing: the cookie is already gone locally.
    request = Promise.resolve(authSignOut()).catch(() => {});
  } catch {
    request = Promise.resolve();
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wait = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  await Promise.race([request, wait]);
  clearTimeout(timer);
  presence.changed();
  await resetAfterSignOut(queryClient);
}

export type AfterSignInDeps = {
  queryClient: QueryClient;
  /** Loads `auth.me` with the new cookie. */
  fetchMe: () => Promise<unknown>;
  presence: Presence;
};

/**
 * After a successful sign-in (password or TOTP): drop anything cached for a
 * previous person, load `auth.me` with the new cookie, and only then tell the
 * gate, so it moves straight to the right screens with no loading flash.
 */
export async function afterSignInWith({ queryClient, fetchMe, presence }: AfterSignInDeps): Promise<void> {
  await resetTenantQueries(queryClient);
  try {
    await fetchMe();
  } catch {
    // The gate shows its offline screen and retries from there.
  }
  presence.changed();
}
