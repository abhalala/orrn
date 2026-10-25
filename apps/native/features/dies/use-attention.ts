import type { AppRouter } from "@orrn/server/routers/index";
import { useQuery } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";

import { queryClient, trpc } from "@/utils/trpc";

import { restPageOffsets } from "./attention";

type Outputs = inferRouterOutputs<AppRouter>;
/** One row of `dieInstance.list`: the copy and its server-computed drift. */
export type CopyRow = Outputs["dieInstance"]["list"]["items"][number];

const PAGE = 200;
/** The rack can be large; a cap keeps the first load honest and the list says when it was reached. */
const MAX_PAGES = 10;

/** Statuses that matter most; if the cap cuts the read short these are still read in full. */
const OUT_OF_RACK = ["in_use", "at_nitriding", "at_maker", "on_trial"] as const;

async function readPage(offset: number, status?: (typeof OUT_OF_RACK)[number]): Promise<Outputs["dieInstance"]["list"]> {
  return queryClient.fetchQuery({ ...trpc.dieInstance.list.queryOptions({ limit: PAGE, offset, ...(status ? { status } : {}) }), staleTime: 0 });
}

async function readStatus(status: (typeof OUT_OF_RACK)[number]): Promise<CopyRow[]> {
  const first = await readPage(0, status);
  const rest = await Promise.all(restPageOffsets(first.total, PAGE, MAX_PAGES).map((o) => readPage(o, status)));
  return [...first.items, ...rest.flatMap((p) => p.items)];
}

/**
 * Every live copy the Dies tab might show, in as few requests as the server allows: one unfiltered
 * `dieInstance.list` (the server has no attention filter; drift is judged per row), then the other pages in
 * one parallel batch, at most `MAX_PAGES` pages in all. `capped` is true when the cap stopped the read (the
 * copies out of the rack are then read in full by status), so the screen can say the list is partial. Retired copies are dropped by `rankAttention`.
 */
export function useAttentionCopies() {
  return useQuery({
    queryKey: [...trpc.dieInstance.list.queryKey(), "attention"],
    queryFn: async () => {
      const first = await readPage(0);
      const offsets = restPageOffsets(first.total, PAGE, MAX_PAGES);
      const rest = await Promise.all(offsets.map((o) => readPage(o)));
      let items: CopyRow[] = [...first.items, ...rest.flatMap((p) => p.items)];
      const capped = first.total > PAGE * MAX_PAGES;
      if (capped) {
        // The cap cut the rack short: the copies that are out of it are few, so read them in full and merge.
        const out = (await Promise.all(OUT_OF_RACK.map(readStatus))).flat();
        items = [...new Map([...items, ...out].map((c) => [c.id, c])).values()];
      }
      return { items, capped };
    },
    staleTime: 30_000,
    retry: false,
  });
}
