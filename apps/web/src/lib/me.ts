import type { Action, MeLike } from "@orrn/api/lib/permissions";
import { can as rawCan, canAny as rawCanAny } from "@orrn/api/lib/permissions";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

export type Me = {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    onboardingCompleted: boolean;
    twoFactorEnabled: boolean;
  };
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string | null;
    modules: string[];
    role: "owner" | "admin" | "manager" | "operator" | "viewer";
  } | null;
  isPlatformAdmin: boolean;
  impersonation: { actorUserId: string; companyId: string; grantId: string; expiresAt: string } | null;
};

/**
 * Read current user identity + tenancy. Always served from React Query cache
 * once a route guard has called `ensureQueryData`. UI should be safe to call
 * this anywhere inside a guarded layout.
 */
export function useMe() {
  return useQuery(trpc.auth.me.queryOptions());
}

/**
 * Plain helper for non-component code (loaders, event handlers).
 *
 * `me` may be null or undefined — both are treated as "no access".
 */
export function can(me: Me | MeLike | null | undefined, action: Action): boolean {
  return rawCan(me as MeLike | null | undefined, action);
}

export function canAny(
  me: Me | MeLike | null | undefined,
  actions: readonly Action[],
): boolean {
  return rawCanAny(me as MeLike | null | undefined, actions);
}

export type { Action };
