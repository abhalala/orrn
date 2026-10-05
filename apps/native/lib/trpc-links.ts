import type { AppRouter } from "@orrn/server/routers/index";
import { httpBatchLink, splitLink, type HTTPHeaders, type TRPCLink } from "@trpc/client";

import { fetchWithTimeout, MUTATION_TIMEOUT_MS, REQUEST_TIMEOUT_MS, type FetchLike } from "./request-timeout";

export type OrrnLinkOptions = {
  /** `${server}/trpc` */
  url: string;
  /** The platform fetch. */
  fetch: FetchLike;
  credentials: RequestCredentials;
  headers: () => HTTPHeaders;
  /** Reads (queries). Default REQUEST_TIMEOUT_MS. */
  queryTimeoutMs?: number;
  /** Saves (mutations). Default MUTATION_TIMEOUT_MS. */
  mutationTimeoutMs?: number;
};

/**
 * The app's tRPC links: reads and saves travel separately, each with its own
 * timeout. A read gives up after 10 s so a dead uplink reaches the offline
 * screen in time. A save gets a long ceiling, because aborting it on the phone
 * does not undo it on the server: a save that committed but whose reply came
 * back late would show as failed, and tapping Save again duplicated the pack
 * session or dispatch. Separate links also mean a save never shares a batched
 * request (and so a timeout) with a read sent in the same tick.
 *
 * Kept free of React Native imports so bun tests drive it with a real tRPC
 * client (__tests__/trpc-links.test.ts); utils/trpc.ts passes the platform bits.
 */
export function orrnLinks({
  url,
  fetch: fetchImpl,
  credentials,
  headers,
  queryTimeoutMs = REQUEST_TIMEOUT_MS,
  mutationTimeoutMs = MUTATION_TIMEOUT_MS,
}: OrrnLinkOptions): TRPCLink<AppRouter>[] {
  const link = (ms: number): TRPCLink<AppRouter> => {
    const timed = fetchWithTimeout(fetchImpl, ms);
    // Typed on AppRouter: if orrn's router ever gains a transformer, this stops compiling.
    return httpBatchLink<AppRouter>({
      url,
      fetch: (input, init) => timed(input, { ...(init as RequestInit), credentials }),
      headers,
    });
  };
  return [
    splitLink<AppRouter>({
      condition: (op) => op.type === "mutation",
      true: link(mutationTimeoutMs),
      false: link(queryTimeoutMs),
    }),
  ];
}
