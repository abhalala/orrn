import { useEffect } from "react";

import { watchCompanyChanges } from "@/lib/session";
import { queryClient } from "@/utils/trpc";

/**
 * Mounted once in the root layout (native twin of web's TenantCacheGuard;
 * AGENTS.md: do not delete). When `auth.me` reports a different company,
 * every other query is reset so the previous company's rows never show. The
 * decision lives in `watchCompanyChanges` (lib/session.ts), tested with a real
 * QueryClient in __tests__/session.test.ts.
 */
export function TenantCacheGuard() {
  useEffect(() => watchCompanyChanges(queryClient), []);
  return null;
}
