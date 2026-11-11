/**
 * The seams between the ingest router (lane A) and the merge (lane B) and bot (lane D) modules.
 *
 * - Bot: lane D's `runShapeAttempt(args)` from `./bot` (it takes an args object, not the plan's
 *   `(ctx, candidate, block)`). Lane A passes a `BotRunStore` over `ingest_bot_run`, the recipe
 *   validator and the in-memory sample check.
 * - Merge: until lane B lands `server/lib/ingest/merge`, a typed stub that throws NOT_IMPLEMENTED.
 *   Expected exports there: `startMerge(ctx)`, `stepMerge(ctx, { runId, expectCursor })`,
 *   `stopMerge(ctx, { runId })`, with the signatures of `MergeEngine` below.
 */
import { env } from "@orrn/env/server";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gte, ne, sql } from "drizzle-orm";

import { ingestBotRun } from "@orrn/db/schema/ingest";

import { createId } from "../id";
import { shapeBotReady, type BotRunStore } from "./bot";
import type { IngestCtx, MergeStepOut } from "./types";

export interface MergeEngine {
  /** Set every approved candidate to merging and open a run. CONFLICT when a run is active. */
  startMerge(ctx: IngestCtx): Promise<{ runId: string }>;
  /** Plan or write the next chunk. CONFLICT when `expectCursor` is stale. */
  stepMerge(ctx: IngestCtx, input: { runId: string; expectCursor: number }): Promise<MergeStepOut>;
  /** Stop after the current chunk. */
  stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut>;
}

function notImplemented(what: string): never {
  throw new TRPCError({ code: "NOT_IMPLEMENTED", message: `${what} is not built yet` });
}

/** Stub until lane B lands `server/lib/ingest/merge`. */
export const mergeEngine: MergeEngine = {
  startMerge: async () => notImplemented("Merge"),
  stepMerge: async () => notImplemented("Merge"),
  stopMerge: async () => notImplemented("Merge"),
};

export function anthropicEnv(): { ANTHROPIC_API_KEY?: string } {
  const key = (env as unknown as { ANTHROPIC_API_KEY?: string }).ANTHROPIC_API_KEY;
  return key ? { ANTHROPIC_API_KEY: key } : {};
}

export const shapeBot = {
  /** A key is set on this stage, or a test client is. */
  botReady: () => shapeBotReady(anthropicEnv()),
};

/** Lane D's store over `ingest_bot_run`, scoped to the context's company. */
export function botRunStore(ctx: Pick<IngestCtx, "db" | "companyId">): BotRunStore {
  return {
    async listBlockRuns(args) {
      const rows = await ctx.db
        .select({ attempt: ingestBotRun.attempt, model: ingestBotRun.model, outcome: ingestBotRun.outcome, errorCodes: ingestBotRun.errorCodes })
        .from(ingestBotRun)
        .where(
          and(
            eq(ingestBotRun.companyId, ctx.companyId),
            eq(ingestBotRun.blockId, args.blockId),
            eq(ingestBotRun.purpose, args.purpose),
            args.sinceMs !== undefined ? gte(ingestBotRun.createdAt, new Date(args.sinceMs)) : undefined,
          ),
        )
        .orderBy(asc(ingestBotRun.createdAt), asc(ingestBotRun.attempt));
      return rows;
    },
    async dayTotals(args) {
      const [row] = await ctx.db
        .select({ calls: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${ingestBotRun.costMicroUsd}), 0)` })
        .from(ingestBotRun)
        .where(and(eq(ingestBotRun.companyId, ctx.companyId), ne(ingestBotRun.outcome, "capped"), gte(ingestBotRun.createdAt, new Date(args.sinceMs))));
      return { calls: Number(row?.calls ?? 0), costMicroUsd: Number(row?.cost ?? 0) };
    },
    async insertRun(row) {
      const id = createId();
      await ctx.db.insert(ingestBotRun).values({
        id,
        companyId: ctx.companyId,
        blockId: row.blockId,
        candidateId: row.candidateId,
        purpose: row.purpose,
        model: row.model,
        attempt: row.attempt,
        outcome: row.outcome,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        costMicroUsd: row.costMicroUsd,
        durationMs: row.durationMs,
        errorCodes: row.errorCodes,
        createdBy: row.createdBy,
        createdAt: new Date(row.createdAtMs),
      });
      return id;
    },
  };
}
