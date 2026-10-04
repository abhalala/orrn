import type { AppRouter } from "@orrn/server/routers/index";
import { env } from "@orrn/env/native";
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { fetchWithTimeout } from "@/lib/request-timeout";
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

/**
 * Every request gives up after 10 s (lib/request-timeout.ts): on Wi-Fi with a
 * dead uplink the OS would otherwise wait 60 s on iOS and indefinitely on
 * Android, and the gate's offline screen would never appear in time.
 */
const timedFetch = fetchWithTimeout((input, init) => fetch(input, init));

const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.EXPO_PUBLIC_SERVER_URL}/trpc`,
      fetch(url, options) {
        return timedFetch(url, {
          ...(options as RequestInit),
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
