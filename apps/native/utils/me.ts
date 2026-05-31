import { useQuery } from "@tanstack/react-query";
import { can, canAny } from "@orrn/server/lib/permissions";
import type { Action, Me } from "@orrn/server/lib/permissions";

import { trpc } from "@/utils/trpc";

/**
 * Native mirror of the web `useMe` hook. The permission matrix and `Me` shape
 * live in `@orrn/server/lib/permissions`; this file only owns native query
 * wiring.
 */
export function useMe() {
  return useQuery(trpc.auth.me.queryOptions());
}

export { can, canAny };
export type { Action, Me };
