/**
 * Call caps (plan B6, "Caps") and the run store the caps read.
 *
 * 4 calls per block per hole version; 300 calls and 5 USD per plant per day, where the day
 * starts at midnight Asia/Kolkata. Counts and cost come from `ingest_bot_run`. This module does
 * not touch the table itself: lane A implements `BotRunStore` over its schema and passes it in.
 */
import type { ShapePurpose } from "./client";

export const BLOCK_CALL_CAP = 4;
export const DAY_CALL_CAP = 300;
/** 5 USD in micro-USD. */
export const DAY_COST_CAP_MICRO = 5_000_000;

export const BOT_OUTCOMES = ["recipe", "no_target", "invalid", "refused", "error", "capped", "sample_failed"] as const;
export type BotOutcome = (typeof BOT_OUTCOMES)[number];

/** What `escalate.ts` needs to know about an earlier run. */
export type BotRunHistoryRow = {
  attempt: number;
  /** The model that actually answered. Fallbacks can change it. */
  model: string;
  outcome: BotOutcome;
  /** Codes of the failure, when the store kept them. Sent back on a retry. */
  errorCodes?: string[] | null;
};

/** One row to write to `ingest_bot_run`. `errorCodes` needs a column or another home (see the report). */
export type BotRunRecord = {
  companyId: string;
  blockId: string;
  candidateId: string | null;
  purpose: ShapePurpose;
  model: string;
  attempt: number;
  outcome: BotOutcome;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicroUsd: number;
  durationMs: number;
  createdBy: string | null;
  createdAtMs: number;
  errorCodes: string[] | null;
};

export interface BotRunStore {
  /**
   * Runs of one block and purpose, oldest first, including `capped` rows. `sinceMs`, when set,
   * is when the current hole version began: older runs belong to an earlier version and are
   * not returned.
   */
  listBlockRuns(args: {
    companyId: string;
    blockId: string;
    purpose: ShapePurpose;
    sinceMs?: number | undefined;
  }): Promise<BotRunHistoryRow[]>;
  /** Model calls (every outcome except `capped`) and their cost for the plant since `sinceMs`. */
  dayTotals(args: { companyId: string; sinceMs: number }): Promise<{ calls: number; costMicroUsd: number }>;
  /** Writes one row and returns its id. */
  insertRun(row: BotRunRecord): Promise<string>;
}

const DAY_MS = 86_400_000;
/** Asia/Kolkata is UTC+05:30 all year. It has no daylight saving. */
const IST_OFFSET_MS = 19_800_000;

/** The instant the plant day containing `nowMs` began, midnight Asia/Kolkata, as epoch ms. */
export function plantDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

export type CapReason = "block_calls" | "day_calls" | "day_cost";

/** Model calls in a history. `capped` rows are not calls. */
export function countCalls(history: readonly BotRunHistoryRow[]): number {
  return history.filter((h) => h.outcome !== "capped").length;
}

/**
 * Whether the next call is allowed. Returns the reason it is not, or null.
 * `history` is the block's runs for this hole version.
 */
export async function checkCaps(args: {
  store: BotRunStore;
  companyId: string;
  history: readonly BotRunHistoryRow[];
  nowMs: number;
}): Promise<CapReason | null> {
  if (countCalls(args.history) >= BLOCK_CALL_CAP) return "block_calls";
  const day = await args.store.dayTotals({ companyId: args.companyId, sinceMs: plantDayStartMs(args.nowMs) });
  if (day.calls >= DAY_CALL_CAP) return "day_calls";
  if (day.costMicroUsd >= DAY_COST_CAP_MICRO) return "day_cost";
  return null;
}

/** An in-memory store for tests and for lane A's early wiring. */
export class MemoryBotRunStore implements BotRunStore {
  readonly rows: (BotRunRecord & { id: string })[] = [];
  private seq = 0;

  async listBlockRuns(args: { companyId: string; blockId: string; purpose: ShapePurpose; sinceMs?: number | undefined }) {
    return this.rows
      .filter(
        (r) =>
          r.companyId === args.companyId &&
          r.blockId === args.blockId &&
          r.purpose === args.purpose &&
          (args.sinceMs === undefined || r.createdAtMs >= args.sinceMs),
      )
      .map((r) => ({ attempt: r.attempt, model: r.model, outcome: r.outcome, errorCodes: r.errorCodes }));
  }

  async dayTotals(args: { companyId: string; sinceMs: number }) {
    const rows = this.rows.filter((r) => r.companyId === args.companyId && r.createdAtMs >= args.sinceMs && r.outcome !== "capped");
    return { calls: rows.length, costMicroUsd: rows.reduce((n, r) => n + r.costMicroUsd, 0) };
  }

  async insertRun(row: BotRunRecord) {
    const id = `run_${++this.seq}`;
    this.rows.push({ ...row, id });
    return id;
  }
}
