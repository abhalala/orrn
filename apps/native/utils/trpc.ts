import type { AppRouter } from "@orrn/server/routers/index";
import { env } from "@orrn/env/native";
import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { Platform } from "react-native";

import { authClient } from "@/lib/auth-client";
import { createQueryClient } from "@/lib/query-client";
import { orrnLinks } from "@/lib/trpc-links";

/**
 * No retries on 4xx or after a timeout, up to 3 on other transient failures,
 * and a 401 anywhere re-checks `auth.me` (lib/query-client.ts).
 */
export const queryClient: QueryClient = createQueryClient();

/**
 * Reads give up after 10 s; saves get a 60 s ceiling, because a save that
 * committed but answered late must not look failed (lib/trpc-links.ts). A
 * save that still times out is "unsure", not "failed": see `writeFailureKind`
 * in lib/request-timeout.ts.
 */
const trpcClient = createTRPCClient<AppRouter>({
  links: orrnLinks({
    url: `${env.EXPO_PUBLIC_SERVER_URL}/trpc`,
    fetch: (input, init) => fetch(input, init),
    // Better Auth Expo forwards the session cookie manually on native.
    credentials: Platform.OS === "web" ? "include" : "omit",
    // Native never sends the impersonation header: impersonation is web-only.
    headers() {
      if (Platform.OS === "web") return {};
      const cookie = authClient.getCookie();
      return cookie ? { Cookie: cookie } : {};
    },
  }),
});

export const trpc = createTRPCOptionsProxy<AppRouter>({
  client: trpcClient,
  queryClient,
});
