import type { AppRouter } from "@orrn/server/routers/index";
import { env } from "@orrn/env/native";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { handleSessionError, shouldRetryQuery } from "@/lib/session";

/**
 * Same policy as web (`apps/web/src/shared/utils/trpc.ts`): no retries on 4xx,
 * up to 3 on transient failures, and a 401 anywhere re-checks `auth.me` so the
 * root gate moves to sign-in when a session ends mid-use. Screens show their
 * own errors; there is no global toast on native.
 */
export const queryClient: QueryClient = new QueryClient({
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

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.EXPO_PUBLIC_SERVER_URL}/trpc`,
      fetch(url, options) {
        return fetch(url, {
          ...options,
          // Better Auth Expo forwards the session cookie manually on native.
          credentials: Platform.OS === "web" ? "include" : "omit",
        });
      },
      // Native never sends the impersonation header: impersonation is web-only.
      headers() {
        if (Platform.OS === "web") return {};
        const cookie = authClient.getCookie();
        return cookie ? { Cookie: cookie } : {};
      },
    }),
  ],
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
