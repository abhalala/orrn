import { describe, expect, test } from "bun:test";

import {
  BLOCK_CALL_CAP,
  DAY_CALL_CAP,
  DAY_COST_CAP_MICRO,
  FakeShapeClient,
  MemoryBotRunStore,
  costOfResponse,
  costOfUsage,
  estimateTokens,
  evaluateSampleStats,
  plantDayStartMs,
  runShapeAttempt,
  type BotRunRecord,
} from "../src/lib/ingest/bot";
import { baseArgs, haiku, recipeAnswer, badAnswer, sonnet } from "./ingest-bot-fixture";

const NOW = Date.UTC(2026, 10, 10, 12, 0, 0);

function runRow(over: Partial<BotRunRecord> = {}): BotRunRecord {
  return {
    companyId: "co1", blockId: "other", candidateId: null, purpose: "shape", model: "claude-haiku-5-5", attempt: 1, outcome: "invalid",
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costMicroUsd: 0, durationMs: 0, createdBy: null, createdAtMs: NOW, errorCodes: null,
    ...over,
  };
}

describe("cost maths, list prices from the claude-api skill (cached 2026-11-03)", () => {
  // Haiku 5.5: 0.10 in, 0.50 out, cache read 0.01, cache write 0.125 (USD per MTok).
  test("Haiku 5.5", () => {
    // Each line uses 100,000 tokens, the largest prompt that is still on the base card.
    expect(costOfUsage("claude-haiku-5-5", { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(10_000);
    expect(costOfUsage("claude-haiku-5-5", { input: 0, output: 100_000, cacheRead: 0, cacheWrite: 0 })).toBe(50_000);
    expect(costOfUsage("claude-haiku-5-5", { input: 0, output: 0, cacheRead: 100_000, cacheWrite: 0 })).toBe(1_000);
    expect(costOfUsage("claude-haiku-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 100_000 })).toBe(12_500);
    // Plan B6 example: about 14,000 in (6,000 cached), up to 8,000 out is about 0.003 USD at 1,500 out.
    expect(costOfUsage("claude-haiku-5-5", { input: 8_000, output: 1_500, cacheRead: 6_000, cacheWrite: 0 })).toBe(800 + 750 + 60);
    expect(costOfUsage("claude-haiku-5-5", { input: 8_000, output: 8_000, cacheRead: 6_000, cacheWrite: 0 })).toBe(800 + 4_000 + 60);
  });

  test("Haiku 5.5 steps up to 0.50 / 2.50 above a 100K token prompt, counting cached tokens", () => {
    const at = { input: 50_000, output: 1_000_000, cacheRead: 50_000, cacheWrite: 0 }; // 100,000 exactly: base card
    expect(costOfUsage("claude-haiku-5-5", at)).toBe(5_000 + 500_000 + 500);
    const over = { input: 50_001, output: 1_000_000, cacheRead: 50_000, cacheWrite: 0 }; // 100,001: long card
    expect(costOfUsage("claude-haiku-5-5", over)).toBe(25_001 + 2_500_000 + 2_500);
  });

  // Sonnet 5.5: 2 in, 10 out, cache read 0.10 (0.05x, not the plan's 0.1x), cache write 2.50.
  test("Sonnet 5.5 cache reads are 0.10 USD per MTok", () => {
    expect(costOfUsage("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 })).toBe(100_000);
    expect(costOfUsage("claude-sonnet-5-5", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(2_000_000);
    expect(costOfUsage("claude-sonnet-5-5", { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(10_000_000);
    expect(costOfUsage("claude-sonnet-5-5", { input: 0, output: 0, cacheRead: 0, cacheWrite: 1_000_000 })).toBe(2_500_000);
  });

  test("plan B6 table: a Sonnet attempt of 14,000 in and 5,000 out is about 0.08 USD", () => {
    expect(costOfUsage("claude-sonnet-5-5", { input: 14_000, output: 5_000, cacheRead: 0, cacheWrite: 0 })).toBe(78_000);
  });

  test("worst block, 2 Haiku and 2 Sonnet, stays near the plan's 0.17 USD", () => {
    const h = costOfUsage("claude-haiku-5-5", { input: 8_000, output: 8_000, cacheRead: 6_000, cacheWrite: 0 });
    const s = costOfUsage("claude-sonnet-5-5", { input: 14_000, output: 5_000, cacheRead: 0, cacheWrite: 0 });
    const total = 2 * h + 2 * s;
    expect(total).toBeGreaterThan(150_000);
    expect(total).toBeLessThan(180_000);
  });

  test("rounding is half up on each part", () => {
    // 5 tokens of Haiku input is 0.5 micro-USD: rounds up to 1.
    expect(costOfUsage("claude-haiku-5-5", { input: 5, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(1);
    expect(costOfUsage("claude-haiku-5-5", { input: 4, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(0);
  });

  test("a fallback is billed per attempt at each model's own price", () => {
    const res = {
      modelUsed: "claude-sonnet-5",
      usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 },
      iterations: [
        { model: "claude-sonnet-5-5", usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
        { model: "claude-sonnet-5", usage: { input: 1_000_000, output: 100_000, cacheRead: 0, cacheWrite: 0 } },
      ],
    };
    expect(costOfResponse(res)).toBe(2_000_000 + 2_000_000 + 1_000_000);
  });

  test("with no iterations the single usage is billed at the model that answered", () => {
    const usage = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(costOfResponse({ modelUsed: "claude-haiku-5-5", usage: { ...usage, input: 100_000 } })).toBe(10_000);
    expect(costOfResponse({ modelUsed: "claude-sonnet-5-5", usage })).toBe(2_000_000);
  });

  test("an unknown model is billed at the Sonnet 5.5 card, never as free", () => {
    expect(costOfUsage("claude-something-new", { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(2_000_000);
  });

  test("token estimate is three characters per token, rounded up", () => {
    expect(estimateTokens(3)).toBe(1);
    expect(estimateTokens(4)).toBe(2);
    expect(estimateTokens(180_000)).toBe(60_000);
  });
});

describe("sample check thresholds, plan B6", () => {
  const s = (over: Partial<Parameters<typeof evaluateSampleStats>[0]>) => evaluateSampleStats({ rows: 100, refused: 0, ambiguous: 0, conflict: 0, requiredBlank: 0, ...over });
  test("refused: 20% passes, 21% fails", () => {
    expect(s({ refused: 20 }).ok).toBe(true);
    expect(s({ refused: 21 }).codes).toEqual(["sample:refused_over_20"]);
  });
  test("ambiguous plus conflict: 40% passes, 41% fails", () => {
    expect(s({ ambiguous: 25, conflict: 15 }).ok).toBe(true);
    expect(s({ ambiguous: 25, conflict: 16 }).codes).toEqual(["sample:ambiguous_over_40"]);
  });
  test("required field blank: 30% passes, 31% fails", () => {
    expect(s({ requiredBlank: 30 }).ok).toBe(true);
    expect(s({ requiredBlank: 31 }).codes).toEqual(["sample:required_blank_over_30"]);
  });
  test("no rows is a failure, and several breaches all report", () => {
    expect(evaluateSampleStats({ rows: 0, refused: 0, ambiguous: 0, conflict: 0, requiredBlank: 0 }).ok).toBe(false);
    expect(s({ refused: 50, requiredBlank: 50 }).codes).toHaveLength(2);
  });
});

describe("caps", () => {
  test("the plan day starts at midnight Asia/Kolkata", () => {
    // 2026-11-10 18:29 UTC is 23:59 IST on the 10th; 18:30 UTC is 00:00 IST on the 11th.
    const startOf10 = Date.UTC(2026, 10, 9, 18, 30, 0);
    expect(plantDayStartMs(Date.UTC(2026, 10, 10, 18, 29, 59))).toBe(startOf10);
    expect(plantDayStartMs(Date.UTC(2026, 10, 10, 18, 30, 0))).toBe(startOf10 + 86_400_000);
    expect(plantDayStartMs(startOf10)).toBe(startOf10);
  });

  test("4 calls per block: the fifth is capped, no call is made, and a capped row is written", async () => {
    const client = new FakeShapeClient([]);
    const store = new MemoryBotRunStore();
    // Four real calls that the planner still lets continue: transport errors alternate with invalid answers.
    const outcomes = ["error", "invalid", "error", "invalid"] as const;
    for (const [i, outcome] of outcomes.entries()) {
      await store.insertRun(runRow({ blockId: "blk1", attempt: i + 1, outcome, model: "claude-haiku-5-5" }));
    }
    expect(BLOCK_CALL_CAP).toBe(4);
    const r = await runShapeAttempt(baseArgs({ client, store }));
    expect(r).toMatchObject({ status: "ran", outcome: "capped", next: "manual", capReason: "block_calls", costMicroUsd: 0 });
    expect(client.calls).toHaveLength(0);
    expect(store.rows[store.rows.length - 1]).toMatchObject({ outcome: "capped", costMicroUsd: 0, attempt: 5 });
  });

  test("capped rows do not count as calls", async () => {
    const client = new FakeShapeClient([haiku(recipeAnswer())]);
    const args = baseArgs({ client });
    await args.store.insertRun(runRow({ blockId: args.block.id, outcome: "capped" }));
    await args.store.insertRun(runRow({ blockId: args.block.id, outcome: "capped" }));
    const r = await runShapeAttempt(args);
    expect(r).toMatchObject({ status: "ran", outcome: "recipe", attempt: 1 });
  });

  test("a new hole version resets the block count", async () => {
    const client = new FakeShapeClient([haiku(recipeAnswer())]);
    const args = baseArgs({ client });
    const old = NOW - 86_400_000;
    for (let i = 1; i <= 4; i++) await args.store.insertRun(runRow({ blockId: args.block.id, attempt: i, outcome: "invalid", createdAtMs: old }));
    const r = await runShapeAttempt({ ...args, holeVersionSinceMs: NOW - 1_000 });
    expect(r).toMatchObject({ status: "ran", outcome: "recipe", attempt: 1 });
  });

  test("300 calls per plant per day: the 301st is capped; yesterday's calls do not count", async () => {
    const client = new FakeShapeClient([haiku(recipeAnswer())]);
    const args = baseArgs({ client });
    const yesterday = plantDayStartMs(NOW) - 1;
    for (let i = 0; i < DAY_CALL_CAP; i++) await args.store.insertRun(runRow({ blockId: `b${i}`, createdAtMs: yesterday }));
    expect(await runShapeAttempt(args)).toMatchObject({ outcome: "recipe" });

    const full = baseArgs({ client: new FakeShapeClient([]) });
    for (let i = 0; i < DAY_CALL_CAP; i++) await full.store.insertRun(runRow({ blockId: `b${i}`, createdAtMs: NOW - 1000 }));
    expect(await runShapeAttempt(full)).toMatchObject({ outcome: "capped", capReason: "day_calls", next: "manual" });
  });

  test("another plant's calls do not count", async () => {
    const args = baseArgs({ client: new FakeShapeClient([haiku(recipeAnswer())]) });
    for (let i = 0; i < DAY_CALL_CAP; i++) await args.store.insertRun(runRow({ companyId: "co2", blockId: `b${i}` }));
    expect(await runShapeAttempt(args)).toMatchObject({ outcome: "recipe" });
  });

  test("5 USD per plant per day: at the limit the call is capped, below it the call runs", async () => {
    // Below the cap by more than one Haiku call's worst case (A8: the claim counts that worst case).
    const below = baseArgs({ client: new FakeShapeClient([haiku(recipeAnswer())]) });
    await below.store.insertRun(runRow({ costMicroUsd: DAY_COST_CAP_MICRO - 100_000 }));
    expect(await runShapeAttempt(below)).toMatchObject({ outcome: "recipe" });

    // Below the cap, but the call's worst case would pass it: capped before the call (A8).
    const edge = baseArgs({ client: new FakeShapeClient([]) });
    await edge.store.insertRun(runRow({ costMicroUsd: DAY_COST_CAP_MICRO - 1 }));
    expect(await runShapeAttempt(edge)).toMatchObject({ outcome: "capped", capReason: "day_cost" });

    const at = baseArgs({ client: new FakeShapeClient([]) });
    await at.store.insertRun(runRow({ costMicroUsd: DAY_COST_CAP_MICRO }));
    expect(await runShapeAttempt(at)).toMatchObject({ outcome: "capped", capReason: "day_cost" });
  });

  test("a call just after midnight Asia/Kolkata starts a fresh day", async () => {
    const justBefore = Date.UTC(2026, 10, 10, 18, 29, 59);
    const justAfter = Date.UTC(2026, 10, 10, 18, 30, 1);
    const store = new MemoryBotRunStore();
    await store.insertRun(runRow({ costMicroUsd: DAY_COST_CAP_MICRO, createdAtMs: justBefore }));
    const args = baseArgs({ client: new FakeShapeClient([haiku(recipeAnswer())]), store, nowMs: () => justAfter });
    expect(await runShapeAttempt(args)).toMatchObject({ outcome: "recipe" });
    const other = new MemoryBotRunStore();
    await other.insertRun(runRow({ costMicroUsd: DAY_COST_CAP_MICRO, createdAtMs: justBefore }));
    const same = baseArgs({ client: new FakeShapeClient([]), store: other, nowMs: () => justBefore + 1 });
    expect(await runShapeAttempt(same)).toMatchObject({ outcome: "capped" });
  });

  test("the cost of earlier calls adds up in the day total", async () => {
    const client = new FakeShapeClient([sonnet(badAnswer(), { usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } })]);
    const args = baseArgs({ client, noFitBlocks: 2 });
    const r = await runShapeAttempt(args);
    expect(r).toMatchObject({ outcome: "invalid", costMicroUsd: 2_000_000 });
    expect(await args.store.dayTotals({ companyId: "co1", sinceMs: plantDayStartMs(NOW) })).toEqual({ calls: 1, costMicroUsd: 2_000_000 });
  });
});
