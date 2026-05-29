import type { AppRouter } from "@orrn/api/routers/index";
import { env } from "@orrn/env/web";
import { QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCOptionsProxy } from "@trpc/tanstack-react-query";
import { toast } from "sonner";

import { getImpersonateCompanyId } from "../lib/impersonation";

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      toast.error(error.message, {
        action: {
          label: "retry",
          onClick: query.invalidate,
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
