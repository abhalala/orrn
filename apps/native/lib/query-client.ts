import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";

import { handleSessionError, shouldRetryQuery } from "./session";

/**
 * The app's QueryClient (utils/trpc.ts). Same policy as web
 * (`apps/web/src/shared/utils/trpc.ts`): no retries on 4xx, up to 3 on
 * transient failures, and a 401 anywhere re-checks `auth.me` so the root gate
 * moves to sign-in when a session ends mid-use (Review Focus 5). Native adds
 * one rule: a request that timed out is not retried (lib/session.ts). Screens
 * show their own errors; there is no global toast on native.
 *
 * Kept free of React Native imports so bun tests exercise the real client
 * (__tests__/session.test.ts).
 */
export function createQueryClient(): QueryClient {
  const queryClient: QueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({
      onError: (error, query) => {
        void handleSessionError(queryClient, error, query.queryKey);
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        void handleSessionError(queryClient, error);
      },
    }),
  });
  return queryClient;
}
