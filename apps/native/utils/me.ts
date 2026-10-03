import { useQuery } from "@tanstack/react-query";
import { can, canAny } from "@orrn/server/lib/permissions";
import type { Action, Me } from "@orrn/server/lib/permissions";

import { trpc } from "@/utils/trpc";

/** Session check is cheap but must not go stale for a whole visit (same as web's W11). */
export const ME_STALE_MS = 30_000;

export function meQueryOptions() {
  return { ...trpc.auth.me.queryOptions(), staleTime: ME_STALE_MS };
}

/**
 * Native mirror of the web `useMe` hook. The permission matrix and `Me` shape
 * live in `@orrn/server/lib/permissions`; this file only owns native query
 * wiring. Screens under the gate always have data: the gate waits for it.
 */
export function useMe() {
  return useQuery(meQueryOptions());
}

export { can, canAny };
export type { Action, Me };
