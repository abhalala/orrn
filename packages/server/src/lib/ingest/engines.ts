/**
 * The seams between the ingest router (lane A) and the merge (lane B) and bot (lane D) modules.
 *
 * Until lane B lands `server/lib/ingest/merge` and lane D lands `server/lib/ingest/bot`, these are
 * typed stubs that throw NOT_IMPLEMENTED. When a lane lands, its module is re-exported here and the
 * router does not change. Expected exports:
 *
 * - `merge/index.ts`: `startMerge(ctx)`, `stepMerge(ctx, { runId, expectCursor })`,
 *   `stopMerge(ctx, { runId })`, with the signatures of `MergeEngine` below.
 * - `bot/index.ts`: `runShapeAttempt(ctx, candidate, block)` (plan B6) and `botReady()`.
 */
import { env } from "@orrn/env/server";
import type { ingestBlock, ingestCandidate } from "@orrn/db/schema/ingest";
import { TRPCError } from "@trpc/server";

import type { IngestCtx, MergeStepOut, ShapeMakeOut } from "./types";

export type CandidateRow = typeof ingestCandidate.$inferSelect;
export type BlockRow = typeof ingestBlock.$inferSelect;

export interface MergeEngine {
  /** Set every approved candidate to merging and open a run. CONFLICT when a run is active. */
  startMerge(ctx: IngestCtx): Promise<{ runId: string }>;
  /** Plan or write the next chunk. CONFLICT when `expectCursor` is stale. */
  stepMerge(ctx: IngestCtx, input: { runId: string; expectCursor: number }): Promise<MergeStepOut>;
  /** Stop after the current chunk. */
  stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut>;
}

export interface ShapeBot {
  /** One model call for one candidate (plan B6). Writes `ingest_bot_run` and, on success, a draft recipe. */
  runShapeAttempt(ctx: IngestCtx, candidate: CandidateRow, block: BlockRow): Promise<ShapeMakeOut>;
  /** True when the Anthropic key is set on this stage. */
  botReady(): boolean;
}

function notImplemented(what: string): never {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `${what} is not built yet` });
}

/** Stub until lane B lands. */
export const mergeEngine: MergeEngine = {
  startMerge: async () => notImplemented("Merge"),
  stepMerge: async () => notImplemented("Merge"),
  stopMerge: async () => notImplemented("Merge"),
};

/** Stub until lane D lands. `botReady` already reads the key so the status screen is right. */
export const shapeBot: ShapeBot = {
  runShapeAttempt: async () => notImplemented("The column helper"),
  botReady: () => {
    const key = (env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
    return typeof key === "string" && key.trim().length > 0;
  },
};
