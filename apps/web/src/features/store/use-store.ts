import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useCallback } from "react";

import { can, canAny, useMe, type Action } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

type Outputs = inferRouterOutputs<AppRouter>;
export type StoreBalance = Outputs["store"]["balances"]["items"][number];
export type StoreItem = Outputs["store"]["items"]["list"]["items"][number];
export type StoreEntry = Outputs["store"]["txns"]["items"][number];

/** Who may add and edit store items (ruling RP19): for `<Can do={ITEM_EDITORS}>`. */
export const ITEM_EDITORS: readonly Action[] = ["store.txn", "masters.publish"];

/**
 * Who may do what in the store (server: routers/store.ts):
 * - read balances and entries: store.txn or masters.publish (storekeeper, manager, admin, owner);
 * - receive, issue, exchange, cancel: store.txn (storekeeper, owner);
 * - add and edit items: store.txn or masters.publish (ruling RP19).
 */
export function useStoreAccess() {
  const { data: me } = useMe();
  return {
    canRead: canAny(me, ["store.txn", "masters.publish"]),
    canEnter: can(me, "store.txn"),
    canEditItems: canAny(me, ITEM_EDITORS),
  };
}

export function useStoreBalances(enabled = true) {
  return useQuery({ ...trpc.store.balances.queryOptions(), enabled });
}

/** Every item, retired ones too (balances leave out retired items at 0). */
export function useStoreItems(enabled = true) {
  return useQuery({ ...trpc.store.items.list.queryOptions(), enabled });
}

export function useStoreEntries(input: { itemId?: string; limit: number }, enabled = true) {
  return useQuery({
    ...trpc.store.txns.queryOptions({ itemId: input.itemId, limit: input.limit }),
    enabled,
    // Paging by a bigger limit keeps the rows already shown while the next page loads; another
    // item's entries are never shown in their place.
    placeholderData: (prev, prevQuery) => (sameItem(prevQuery?.queryKey, input.itemId) ? prev : undefined),
  });
}

/** Whether a cached store.txns query key is for this item (or the whole store when undefined). */
function sameItem(queryKey: readonly unknown[] | undefined, itemId: string | undefined): boolean {
  const opts = queryKey?.[1] as { input?: { itemId?: string } } | undefined;
  return opts?.input?.itemId === itemId;
}

/** After any store write: balances, entries and items all refetch. */
export function useInvalidateStore() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries(trpc.store.pathFilter()), [queryClient]);
}
