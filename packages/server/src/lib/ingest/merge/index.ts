/**
 * The Infinity Portal merge (plan A5): the entry points lane A's `ingest.merge.*` procedures call
 * through `MergeEngine` in `../engines.ts`. The router must pass its full procedure context: the
 * adapters hand it to `appRouter.createCaller`, which runs the middlewares again.
 */
import type { MergeStepOut, IngestCtx } from "../types";
import { startMerge, stepMerge, stopMerge } from "./runner";

export { startMerge, stepMerge, stopMerge };
export { sourceMeta } from "./provenance";
export { chunkIdOf } from "./planner";

/** Same shape as `MergeEngine` in `../engines.ts`; lane A swaps its stub for this. */
export const mergeEngine: {
  startMerge(ctx: IngestCtx): Promise<{ runId: string }>;
  stepMerge(ctx: IngestCtx, input: { runId: string; expectCursor: number }): Promise<MergeStepOut>;
  stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut>;
} = { startMerge, stepMerge, stopMerge };
