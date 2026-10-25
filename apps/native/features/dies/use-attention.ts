import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import { queryClient, trpc } from "@/utils/trpc";

import type { CopyStatus } from "./attention";

type Outputs = inferRouterOutputs<AppRouter>;
/** One row of `dieInstance.list`: the copy and its server-computed drift. */
export type CopyRow = Outputs["dieInstance"]["list"]["items"][number];

const PAGE = 200;
/** The rack can be large; a cap keeps the first load honest and the list says when it was reached. */
const MAX_PAGES = 10;
/** Statuses that are always on the list, so they are read in full. The rack (`available`) is paged. */
const OUT_OF_RACK: readonly CopyStatus[] = ["in_use", "at_nitriding", "at_maker", "on_trial"];

async function readStatus(status: CopyStatus): Promise<{ items: CopyRow[]; capped: boolean }> {
  const items: CopyRow[] = [];
  let offset: number | null = 0;
  for (let page = 0; offset !== null && page < MAX_PAGES; page++) {
    const res: Outputs["dieInstance"]["list"] = await queryClient.fetchQuery({ ...trpc.dieInstance.list.queryOptions({ status, limit: PAGE, offset }), staleTime: 0 });
    items.push(...res.items);
    offset = res.nextOffset;
  }
  return { items, capped: offset !== null };
}

/**
 * Every live copy the Dies tab might show: the ones out of the rack in full, and the rack page by
 * page (drift is judged by the server per row, the list cannot filter on it). `capped` is true when
 * the cap stopped the read, so the screen can say the list is partial.
 */
export function useAttentionCopies() {
  return useQuery({
    queryKey: [...trpc.dieInstance.list.queryKey(), "attention"],
    queryFn: async () => {
      const parts = await Promise.all([readStatus("available"), ...OUT_OF_RACK.map(readStatus)]);
      return { items: parts.flatMap((p) => p.items), capped: parts.some((p) => p.capped) };
    },
    staleTime: 30_000,
    retry: false,
  });
}
