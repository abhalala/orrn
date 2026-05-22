import type { Action, MeLike } from "@orrn/api/lib/permissions";
import { can as rawCan, canAny as rawCanAny } from "@orrn/api/lib/permissions";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

export type Me = {
  user: { id: string; name: string; email: string; image: string | null };
  company: {
    id: string;
    name: string;
    slug: string;
    status: string;
    plan: string | null;
    role: "owner" | "admin" | "manager" | "operator" | "viewer";
  } | null;
  isPlatformAdmin: boolean;
  impersonation: { actorUserId: string; companyId: string } | null;
};

/**
 * Native mirror of apps/web/src/lib/me.ts. Reads `auth.me` via React Query so
 * the result is shared across the drawer layout and every screen.
 */
export function useMe() {
  return useQuery(trpc.auth.me.queryOptions());
}

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
