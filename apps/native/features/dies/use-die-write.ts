import { useQueryClient } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";

/** After a die-room write: every die read (cards, lists, issues, makers) is stale. */
export function useRefreshDieRoom() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries(trpc.dieInstance.pathFilter());
    void queryClient.invalidateQueries(trpc.die.pathFilter());
  };
}
