/**
 * Call caps (plan B6, "Caps") and the run store the caps read.
 *
 * By default 4 calls per block per hole version; 300 calls and 5 USD per plant per day (staff may set
 * a plant's own values in Godseye, passed in as `caps`), where the day
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

/** What a store keeps: an outcome, or `pending` while a claimed call has not answered (A8). */
export type StoredOutcome = BotOutcome | "pending";

/** What `escalate.ts` needs to know about an earlier run. */
export type BotRunHistoryRow = {
  attempt: number;
  /** The model asked for, which is the model that answered (any other answer is an error row). */
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
  outcome: StoredOutcome;
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
  /**
   * Replaces a `pending` row with the call's result. A store that has it lets a call claim its place
   * under the caps before the model is called, so parallel calls cannot all pass the same count (A8).
   * Listings report a `pending` row as `error`: it is a call that counts.
   */
  finishRun?(id: string, row: BotRunRecord): Promise<void>;
  /**
   * Writes a `pending` row only when no other live `pending` row of the same key and purpose exists (one
   * statement, so two tabs cannot both claim). A `pending` row older than `staleMs` is a call whose
   * Worker stopped: it no longer holds the key. Returns the new id, or null when another call holds the
   * key. The vision read uses it so one page or band is never paid for twice at once.
   */
  claimRun?(row: BotRunRecord, staleMs: number): Promise<string | null>;
}

const DAY_MS = 86_400_000;
/** Asia/Kolkata is UTC+05:30 all year. It has no daylight saving. */
const IST_OFFSET_MS = 19_800_000;

/** The instant the plant day containing `nowMs` began, midnight Asia/Kolkata, as epoch ms. */
export function plantDayStartMs(nowMs: number): number {
  return Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS;
}

export type CapReason = "block_calls" | "day_calls" | "day_cost";

/**
 * The three caps of one plant. The constants above are the defaults; a plant's own values come from
 * `effectiveLimits` (`lib/plantLimits.ts`, set by staff in Godseye) and are passed in by the caller.
 */
export type CapValues = { blockCalls: number; dayCalls: number; dayCostMicro: number };

export const DEFAULT_CAPS: CapValues = { blockCalls: BLOCK_CALL_CAP, dayCalls: DAY_CALL_CAP, dayCostMicro: DAY_COST_CAP_MICRO };

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
  caps?: CapValues | undefined;
}): Promise<CapReason | null> {
  const caps = args.caps ?? DEFAULT_CAPS;
  if (countCalls(args.history) >= caps.blockCalls) return "block_calls";
  const day = await args.store.dayTotals({ companyId: args.companyId, sinceMs: plantDayStartMs(args.nowMs) });
  if (day.calls >= caps.dayCalls) return "day_calls";
  if (day.costMicroUsd >= caps.dayCostMicro) return "day_cost";
  return null;
}

/**
 * The caps again after this call's `pending` row is in: the block and day counts now include it, so
 * they may reach the cap but not pass it. Two calls that claimed at once both see each other. The day
 * cost includes every claim's worst-case cost, so it too may reach the cap but not pass it.
 */
export async function capsAfterClaim(args: {
  store: BotRunStore;
  companyId: string;
  blockId: string;
  purpose: ShapePurpose;
  sinceMs?: number | undefined;
  nowMs: number;
  caps?: CapValues | undefined;
}): Promise<CapReason | null> {
  const caps = args.caps ?? DEFAULT_CAPS;
  const history = await args.store.listBlockRuns({ companyId: args.companyId, blockId: args.blockId, purpose: args.purpose, sinceMs: args.sinceMs });
  if (countCalls(history) > caps.blockCalls) return "block_calls";
  const day = await args.store.dayTotals({ companyId: args.companyId, sinceMs: plantDayStartMs(args.nowMs) });
  if (day.calls > caps.dayCalls) return "day_calls";
  if (day.costMicroUsd > caps.dayCostMicro) return "day_cost";
  return null;
}

/** A stored outcome as history: a `pending` call counts as an `error` call. */
export function historyOutcome(o: StoredOutcome): BotOutcome {
  return o === "pending" ? "error" : o;
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
      .map((r) => ({ attempt: r.attempt, model: r.model, outcome: historyOutcome(r.outcome), errorCodes: r.errorCodes }));
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

  async finishRun(id: string, row: BotRunRecord) {
    const i = this.rows.findIndex((r) => r.id === id);
    if (i !== -1) this.rows[i] = { ...row, id };
  }

  async claimRun(row: BotRunRecord, staleMs: number) {
    const held = this.rows.some(
      (r) => r.companyId === row.companyId && r.blockId === row.blockId && r.purpose === row.purpose && r.outcome === "pending" && r.createdAtMs > row.createdAtMs - staleMs,
    );
    return held ? null : this.insertRun(row);
  }
}
