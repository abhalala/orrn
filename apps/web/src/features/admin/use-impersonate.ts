import { useNavigate } from "@tanstack/react-router";

import { setImpersonation } from "@/shared/lib/impersonation";
import { queryClient } from "@/shared/utils/trpc";

import type { DateInput } from "./format";

/**
 * Enter a company as support with a live grant: remember the target until
 * the grant's end (sessionStorage, read by the tRPC link on every request),
 * drop every cached query (Godseye data must never mix with the company's),
 * and open Today. The `_tenant` guard then loads `auth.me` as the company's
 * owner and the shell shows the banner.
 */
export function useEnterCompany() {
  const navigate = useNavigate();
  return async (companyId: string, expiresAt: DateInput) => {
    setImpersonation(companyId, new Date(expiresAt));
    queryClient.clear();
    await navigate({ to: "/today" });
  };
}
