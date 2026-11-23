import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { trpc } from "@/shared/utils/trpc";

/** After any write on a work order: the work order, the list and the spares candidates read again. */
export function useInvalidateWo() {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.maint.workOrders.pathKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.maint.spares.pathKey() }),
    ]);
  }, [queryClient]);
}

/** A stale save: the server says the row moved on since it was opened. */
export function isConflict(error: unknown): boolean {
  return (error as { data?: { code?: string } } | null)?.data?.code === "CONFLICT";
}
