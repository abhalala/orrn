import type { AppRouter } from "@orrn/server/routers/index";
import { env } from "@orrn/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { TRPCClientError, createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { getImpersonateCompanyId } from "../lib/impersonation";

function isAuthMeQueryKey(queryKey: unknown): boolean {
  return (
    Array.isArray(queryKey) &&
    Array.isArray(queryKey[0]) &&
    queryKey[0][0] === "auth" &&
    queryKey[0][1] === "me"
  );
}

function shouldToastQueryError(error: unknown, query: { queryKey: unknown }): boolean {
  if (isAuthMeQueryKey(query.queryKey)) {
    return false;
  }
  if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") {
    return false;
  }
  return true;
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
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
});

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    httpBatchLink({
      url: `${env.VITE_SERVER_URL}/trpc`,
      fetch(url, options) {
        const headers = new Headers(options?.headers);
        const impersonateCompanyId = getImpersonateCompanyId();
        if (impersonateCompanyId) {
          headers.set("x-orrn-impersonate-company", impersonateCompanyId);
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
