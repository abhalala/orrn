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
    // Paging by a bigger limit keeps the rows already shown while the next page loads.
    placeholderData: (prev) => prev,
  });
}

/** After any store write: balances, entries and items all refetch. */
export function useInvalidateStore() {
  const queryClient = useQueryClient();
  return useCallback(() => queryClient.invalidateQueries(trpc.store.pathFilter()), [queryClient]);
}

/** The server's message for a failed call ("Only 2 kg of Cover flux in the store"). */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return String(error);
}
