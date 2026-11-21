import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { can, canAny, type Me } from "@/shared/lib/me";
import { trpcClient } from "@/shared/utils/trpc";

import type { IngestOutputs } from "./api";

/**
 * Item 16 (owner decision "Price-viewers tick, admin approves"). Who sees which import screens:
 * - "full": `ingest.upload` or `ingest.merge` (admin, owner): every import screen, as before.
 * - "check": `ingest.check` only (office, manager, accountant): the list of tables waiting for a check on the Imports
 *   page, and the review of one model-read table, read only, with its tick. No upload, files, merge or other review.
 * - "none": no import screen.
 */
export type IngestAccessKind = "full" | "check" | "none";

export function ingestAccessOf(me: Me | null | undefined): IngestAccessKind {
  if (canAny(me, ["ingest.upload", "ingest.merge"])) return "full";
  return can(me, "ingest.check") ? "check" : "none";
}

export type VisionWaitingItem = IngestOutputs["vision"]["waiting"][number];

/** Under `["ingest", "candidates"]`, so `refreshIngest` after a tick refreshes it and a ticked table drops off. */
export const waitingKey = ["ingest", "candidates", "waitingCheck"] as const;

/** `vision.waiting`: model-read tables of the plant not ticked yet, in the states where the review offers the tick. */
export function useVisionWaiting(enabled = true): UseQueryResult<VisionWaitingItem[]> {
  return useQuery({
    queryKey: waitingKey,
    queryFn: () => trpcClient.ingest.vision.waiting.query(),
    enabled,
    staleTime: 15_000,
    meta: INLINE_ERROR_META,
  });
}
