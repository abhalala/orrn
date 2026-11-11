/**
 * Infinity Portal merge planner, pure parts (plan A5): the chunk id is the same for the same rows and
 * changes with them; runs split at the size limit and where creates turn into updates; orders keep
 * their rows together and pack at most 10 orders per chunk.
 */
import { describe, expect, test } from "bun:test";

import { chunkIdOf, cutOrderRuns, cutRuns } from "../src/lib/ingest/merge/planner";

const rows = (n: number, state = "ready_create", group: (i: number) => string | null = () => null) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${i}`, rowIndex: i, state, group: group(i) }));

describe("chunk id", () => {
  test("ing- plus 40 hex; the same input gives the same id, other rows another", async () => {
    const base = { candidateId: "c1", target: "customers" as const, holeRef: "builtin:customers@1", rowFrom: 0, rowTo: 2, rowIds: ["a", "b", "c"] };
    const id = await chunkIdOf(base);
    expect(id).toMatch(/^ing-[0-9a-f]{40}$/);
    expect(await chunkIdOf({ ...base })).toBe(id);
    expect(await chunkIdOf({ ...base, rowIds: ["a", "c"] })).not.toBe(id);
    expect(await chunkIdOf({ ...base, holeRef: "learned:v2" })).not.toBe(id);
    expect(await chunkIdOf({ ...base, rowTo: 3 })).not.toBe(id);
  });
});

describe("runs", () => {
  test("bulk targets cut at 500 rows", () => {
    expect(cutRuns("customers", rows(1001)).map((r) => r.length)).toEqual([500, 500, 1]);
    expect(cutRuns("bundles", rows(500)).map((r) => r.length)).toEqual([500]);
  });

  test("one-call-per-row targets cut at 20 rows", () => {
    expect(cutRuns("vendors", rows(45)).map((r) => r.length)).toEqual([20, 20, 5]);
    expect(cutRuns("die_copies", rows(20)).map((r) => r.length)).toEqual([20]);
  });

  test("creates and updates never share a chunk where updates take another procedure", () => {
    const mixed = [...rows(3), ...rows(2, "ready_update").map((r, i) => ({ ...r, id: `u${i}`, rowIndex: 3 + i })), { id: "x", rowIndex: 5, state: "ready_create", group: null }];
    expect(cutRuns("customers", mixed).map((r) => r.map((x) => x.state[6]))).toEqual([["c", "c", "c"], ["u", "u"], ["c"]]);
    // die.processImport takes both in one call.
    expect(cutRuns("dies", mixed).map((r) => r.length)).toEqual([6]);
  });
});

describe("orders", () => {
  test("rows of one order stay together; whole orders pack up to 10 per chunk", () => {
    // 12 orders of 3 adjacent rows each.
    const r = rows(36, "ready_create", (i) => `o${Math.floor(i / 3)}`);
    const runs = cutOrderRuns(r);
    expect(runs.map((x) => x.length)).toEqual([30, 6]);
    for (const run of runs) {
      const groups = new Set(run.map((x) => x.group));
      for (const g of groups) expect(r.filter((x) => x.group === g).every((x) => run.includes(x))).toBe(true);
    }
  });

  test("interleaved orders join into one component; above 10 orders it is cut by rows", () => {
    // 4 orders interleaved: one component, one chunk.
    expect(cutOrderRuns(rows(12, "ready_create", (i) => `o${i % 4}`)).map((x) => x.length)).toEqual([12]);
    // 15 orders interleaved: cut where an 11th order would start.
    const cut = cutOrderRuns(rows(30, "ready_create", (i) => `o${i % 15}`));
    expect(cut.map((x) => new Set(x.map((y) => y.group)).size).every((n) => n <= 10)).toBe(true);
    expect(cut.flat()).toHaveLength(30);
  });

  test("an order above 100 lines counts as several orders", () => {
    const big = rows(250, "ready_create", () => "one");
    const runs = cutOrderRuns(big);
    expect(runs.flat()).toHaveLength(250);
    expect(runs).toHaveLength(1);
  });
});
