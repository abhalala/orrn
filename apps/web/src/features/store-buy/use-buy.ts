import type { AppRouter } from "@orrn/server/routers/index";
import { useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { can, canAny, useMe, type Action } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type IndentRow = Outputs["store"]["indents"]["list"]["items"][number];
export type IndentDetail = Outputs["store"]["indents"]["get"];
export type PoRow = Outputs["store"]["po"]["list"]["items"][number];
export type PoDetail = Outputs["store"]["po"]["get"];
export type PoOpenLine = Outputs["store"]["po"]["openLines"]["items"][number];
export type ValuationItem = Outputs["store"]["valuation"]["items"]["items"][number];
export type MonthValuation = Outputs["store"]["valuation"]["month"];
export type BelowMinimumItem = Outputs["store"]["belowMinimum"]["items"][number];

/** Who sees the Buying page at all (server: routers/storeIndent.ts, storePo.ts, storeValuation.ts). */
export const BUY_PEOPLE: readonly Action[] = ["indent.raise", "indent.approve", "po.view", "po.manage", "store.value"];

/**
 * What this person may do on the Buying page:
 * - indents: read (indent.raise, indent.approve, po.view, po.manage), raise (indent.raise), decide (indent.approve);
 * - orders: read (po.view, po.manage), write (po.manage);
 * - value: store.value; the over-delivery allowance: masters.publish.
 */
export function useBuyAccess() {
  const { data: me } = useMe();
  return {
    any: canAny(me, BUY_PEOPLE),
    readIndents: canAny(me, ["indent.raise", "indent.approve", "po.view", "po.manage"]),
    raise: can(me, "indent.raise"),
    decide: can(me, "indent.approve"),
    readOrders: canAny(me, ["po.view", "po.manage"]),
    manageOrders: can(me, "po.manage"),
    value: can(me, "store.value"),
    setAllowance: can(me, "masters.publish"),
    userId: me?.user.id ?? null,
  };
}

/** After any buying write: indents, orders, the store lists and Today's low-stock tile refetch. */
export function useInvalidateBuy() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries(trpc.store.pathFilter()), [queryClient]);
}
