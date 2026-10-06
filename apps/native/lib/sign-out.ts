import { meQueryOptions } from "@/utils/me";
import { queryClient } from "@/utils/trpc";

import { authClient } from "./auth-client";
import { sessionPresence } from "./session-presence";
import { afterSignInWith, signOutWith } from "./sign-out-flow";

/**
 * Every sign-out path: cookie gone, gate flipped, cache reset, and no more
 * than about 1.5 s spent waiting for the server (see lib/sign-out-flow.ts).
 */
export function signOut(): Promise<void> {
  return signOutWith({
    authSignOut: () => authClient.signOut(),
    presence: sessionPresence,
    queryClient,
  });
}

/** After a successful sign-in: reset, load `auth.me`, then tell the gate (lib/sign-out-flow.ts). */
export function afterSignIn(): Promise<void> {
  return afterSignInWith({
    queryClient,
    fetchMe: () => queryClient.fetchQuery({ ...meQueryOptions(), staleTime: 0, retry: false }),
    presence: sessionPresence,
  });
}
