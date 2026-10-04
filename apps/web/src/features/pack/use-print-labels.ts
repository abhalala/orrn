import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { can, useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { printQueueFor, type PrintItem, type PrintQueue, type PrintState } from "./print-labels";

const printOne = (item: PrintItem) => trpcClient.spool.printBundleLabel.mutate({ bundleId: item.bundleId });

/** The print queue for one packing session, printing through `spool.printBundleLabel`. */
export function sessionPrintQueue(groupId: string): PrintQueue {
  return printQueueFor(groupId, printOne);
}

/** Live state of a session's print queue, plus its controls. */
export function usePrintQueue(groupId: string): PrintState & Pick<PrintQueue, "run" | "retryFailed"> {
  const q = sessionPrintQueue(groupId);
  const state = useSyncExternalStore(q.subscribe, q.getState, q.getState);
  return { ...state, run: q.run, retryFailed: q.retryFailed };
}

/**
 * Whether this person can print bundle labels right now: their role holds
 * `spool.create_jobs` and the company's label printing is connected. The
 * deployment is only asked about for roles that could print.
 */
export function useCanPrintLabels(): { canPrint: boolean; checking: boolean } {
  const { data: me } = useMe();
  const allowed = can(me, "spool.create_jobs");
  const deployment = useQuery({
    ...trpc.spool.deploymentStatus.queryOptions(),
    enabled: allowed,
    staleTime: 60_000,
  });
  return {
    canPrint: allowed && deployment.data?.status === "active",
    checking: allowed && deployment.isPending,
  };
}
