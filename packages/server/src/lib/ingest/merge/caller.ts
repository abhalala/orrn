/**
 * The adapters call the existing procedures through `appRouter.createCaller` with the person's own
 * context plus the provenance (plan A5, A6). Module gates and action guards therefore apply exactly
 * as when the person calls the procedure. `routers/index.ts` is imported lazily: the ingest router
 * is mounted there, so a static import would be a cycle.
 *
 * The context must be the full procedure context the ingest router received (session, membership,
 * role, header flags), not a narrowed copy: `createCaller` runs the middlewares again on it.
 */
import { TRPCError } from "@trpc/server";

import type { Context } from "../../../context";
import type { IngestSource } from "../source";
import type { IngestCtx } from "../types";
import type { CallerFor, MergeCaller } from "./shared";

export function callerFor(ctx: IngestCtx): CallerFor {
  const full = ctx as unknown as Context;
  if (!full.membership || !full.session) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The merge needs the full request context" });
  }
  return async (source: IngestSource): Promise<MergeCaller> => {
    const { appRouter } = await import("../../../routers/index");
    return appRouter.createCaller({ ...full, ingestSource: source });
  };
}
