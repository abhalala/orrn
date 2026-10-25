import { httpBatchLink, splitLink, type TRPCLink } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";

import { isPartyProcedure } from "./portal-plant";

type LinkOptions = {
  url: string;
  fetch?: typeof fetch;
  getPlant: () => string | null;
  getImpersonation: () => string | null;
};

/**
 * The one tRPC link. A party's `portal.*` calls (those that honour `x-orrn-company`) travel in their
 * own batch that carries the party's chosen plant; every other call travels in a batch that never
 * does. They can not share a batch: the header applies to a whole HTTP request, and a request that
 * mixed the two would drop the plant choice (the server then reads the party's newest plant) or hand
 * a plant member's call a plant header they do not belong to (refused). Review W3-PORTAL-W I-1.
 */
export function buildTrpcLink<TRouter extends AnyRouter>(opts: LinkOptions): TRPCLink<TRouter> {
  const send =
    (withPlant: boolean): typeof fetch =>
    (input, init) => {
      const headers = new Headers(init?.headers);
      const impersonation = opts.getImpersonation();
      if (impersonation) headers.set("x-orrn-impersonate-company", impersonation);
      const plant = withPlant ? opts.getPlant() : null;
      if (plant) headers.set("x-orrn-company", plant);
      return (opts.fetch ?? fetch)(input, { ...init, headers, credentials: "include" });
    };
  // This API has no data transformer, so the options are just the url and fetch. The link is written
  // against any router; the one caller passes its own router type.
  const batch = (withPlant: boolean) => httpBatchLink<AnyRouter>({ url: opts.url, fetch: send(withPlant) } as never);
  return splitLink<AnyRouter>({
    condition: (op) => isPartyProcedure(op.path),
    true: batch(true),
    false: batch(false),
  }) as unknown as TRPCLink<TRouter>;
}
