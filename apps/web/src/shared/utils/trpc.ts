import type { AppRouter } from "@orrn/server/routers/index";
import { env } from "@orrn/env/web";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { clearImpersonation, getImpersonation, hasStoredImpersonation } from "../lib/impersonation";
import {
  isImpersonationForbidden,
  isUnauthorized,
  shouldRetryQuery,
} from "../lib/session-errors";
import { isAuthMeQueryKey } from "../lib/tenant-cache";

function shouldToastQueryError(error: unknown, query: { queryKey: unknown }): boolean {
  if (isAuthMeQueryKey(query.queryKey)) {
    return false;
  }
  if (isUnauthorized(error) || isImpersonationForbidden(error)) {
    return false;
  }
  return true;
}

/**
 * The router lives in main.tsx and imports this module, so it registers the
 * "session ended" navigation here instead of being imported (no cycle).
 */
let onSessionEnded: (() => void) | null = null;
export function registerSessionEndedHandler(handler: (() => void) | null) {
  onSessionEnded = handler;
}

/**
 * Global session recovery for every query and mutation (W2, W11):
 * - UNAUTHORIZED: the session expired mid-use → /login?next=<current page>.
 * - FORBIDDEN impersonation message: the grant expired or was revoked → drop
 *   it and reload as the plain user.
 */
function handleSessionError(error: unknown) {
  if (isImpersonationForbidden(error)) {
    if (hasStoredImpersonation()) {
      clearImpersonation();
      queryClient.clear();
      window.location.reload();
    }
    return;
  }
  if (isUnauthorized(error)) {
    onSessionEnded?.();
  }
}

export const queryClient: QueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      handleSessionError(error);
      if (!shouldToastQueryError(error, query)) {
        return;
      }
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: () => query.invalidate(),
        },
      });
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      handleSessionError(error);
    },
  }),
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_SERVER_URL}/trpc`,
      fetch(url, options) {
        const headers = new Headers(options?.headers);
        const impersonation = getImpersonation();
        if (impersonation) {
          headers.set("x-orrn-impersonate-company", impersonation.companyId);
        }
        return fetch(url, {
          ...options,
          headers,
          credentials: "include",
        });
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
