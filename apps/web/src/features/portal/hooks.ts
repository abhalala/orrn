import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/shared/utils/trpc";

/** Who the party is, which plant and language (`portal.me`). Retries are off: a refusal is the answer. */
export function usePortalMe() {
  return useQuery({ ...trpc.portal.me.queryOptions(), retry: false, staleTime: 60_000 });
}

/** Message of a tRPC error, or null. */
export function errorMessage(error: unknown): string | null {
  return error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
    ? (error as { message: string }).message
    : null;
}
