/**
 * The seams between the ingest router (lane A) and the merge (lane B) and bot (lane D) modules.
 *
 * - Bot: lane D's `runShapeAttempt(args)` from `./bot` (it takes an args object, not the plan's
 *   `(ctx, candidate, block)`). Lane A passes a `BotRunStore` over `ingest_bot_run`, the recipe
 *   validator and the in-memory sample check.
 * - Merge: lane B's `./merge` (`startMerge`, `stepMerge`, `stopMerge`), typed by `MergeEngine` below.
 */
import { env } from "@orrn/env/server";
import { and, asc, eq, gte, ne, sql } from "drizzle-orm";

import { ingestBotRun } from "@orrn/db/schema/ingest";

import { createId } from "../id";
import { shapeBotReady, type BotRunStore, type ShapeEnv } from "./bot";
import { historyOutcome, type BotRunRecord } from "./bot/caps";
import { mergeEngine as mergeImpl } from "./merge";
import type { IngestCtx, MergeStepOut } from "./types";

export interface MergeEngine {
  /** Set every approved candidate to merging and open a run. CONFLICT when a run is active. */
  startMerge(ctx: IngestCtx): Promise<{ runId: string }>;
  /** Plan or write the next chunk. CONFLICT when `expectCursor` is stale. */
  stepMerge(ctx: IngestCtx, input: { runId: string; expectCursor: number }): Promise<MergeStepOut>;
  /** Stop after the current chunk. */
  stopMerge(ctx: IngestCtx, input: { runId: string }): Promise<MergeStepOut>;
}

/** Lane B's merge: planner, step runner and adapters in `./merge`. */
export const mergeEngine: MergeEngine = mergeImpl;

/** The model route from the Worker bindings: the key, and the optional proxy URL and Access pair. */
export function anthropicEnv(): ShapeEnv {
  const out: ShapeEnv = {};
  if (env.ANTHROPIC_API_KEY) out.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  if (env.ANTHROPIC_BASE_URL) out.ANTHROPIC_BASE_URL = env.ANTHROPIC_BASE_URL;
  if (env.MODEL_ACCESS_CLIENT_ID) out.MODEL_ACCESS_CLIENT_ID = env.MODEL_ACCESS_CLIENT_ID;
  if (env.MODEL_ACCESS_CLIENT_SECRET) out.MODEL_ACCESS_CLIENT_SECRET = env.MODEL_ACCESS_CLIENT_SECRET;
  return out;
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
      return rows.map((r) => ({ ...r, outcome: historyOutcome(r.outcome) }));
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
      await ctx.db.insert(ingestBotRun).values({ id, ...runValues(ctx.companyId, row) });
      return id;
    },
    async finishRun(id, row) {
      await ctx.db
        .update(ingestBotRun)
        .set(runValues(ctx.companyId, row))
        .where(and(eq(ingestBotRun.id, id), eq(ingestBotRun.companyId, ctx.companyId)));
    },
  };
}

function runValues(companyId: string, row: BotRunRecord) {
  return {
    companyId,
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
  };
}
