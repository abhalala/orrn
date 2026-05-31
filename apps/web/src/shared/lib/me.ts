import { useQuery } from "@tanstack/react-query";
import { can, canAny } from "@orrn/server/lib/permissions";
import type { Action, Me } from "@orrn/server/lib/permissions";

import { trpc } from "../utils/trpc";

/**
 * Read current user identity + tenancy. Always served from React Query cache
 * once a route guard has called `ensureQueryData`. UI should be safe to call
 * this anywhere inside a guarded layout.
 */
export function useMe() {
  return useQuery(trpc.auth.me.queryOptions());
}

export { can, canAny };
export type { Action, Me };
