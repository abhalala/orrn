import { describe, expect, test } from "bun:test";

import type { DieImportRow } from "./parse";
import { dieChunkInput, planDies, runChunks } from "./submit";

describe("runChunks: the sheet is saved 500 rows per call", () => {
  test("1,200 rows go as 500, 500 and 200, with progress after each call", async () => {
    const sizes: number[] = [];
    const progress: number[] = [];
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const res = await runChunks(items, async (chunk) => sizes.push(chunk.length), {
      onProgress: (done) => progress.push(done),
    });
    expect(sizes).toEqual([500, 500, 200]);
    expect(progress).toEqual([500, 1000, 1200]);
    expect(res).toMatchObject({ ok: true, done: 1200 });
  });

  test("a failing call stops the run and says how far it got", async () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const boom = new Error("Dies previously deleted: 40 / 4012");
    const res = await runChunks(items, async (_chunk, index) => {
      if (index === 1) throw boom;
      return index;
    });
    expect(res).toEqual({ ok: false, done: 500, failedChunk: 1, error: boom, results: [0] });
  });

  test("a retry resumes at the failed chunk, so saved rows are never sent twice", async () => {
    const items = Array.from({ length: 1200 }, (_, i) => i);
    const firsts: number[] = [];
    const res = await runChunks(items, async (chunk) => firsts.push(chunk[0]!), { startChunk: 1 });
    expect(firsts).toEqual([500, 1000]);
    expect(res).toMatchObject({ ok: true, done: 1200 });
  });

  test("nothing to send is a no-op", async () => {
    let calls = 0;
    const res = await runChunks([], async () => calls++);
    expect(calls).toBe(0);
    expect(res).toMatchObject({ ok: true, done: 0 });
  });
});

const die = (series: string, sectionCode: string): DieImportRow => ({
  series,
  sectionCode,
  name: null,
  weightMinG: 1000,
  weightMaxG: 1200,
  dimensions: {},
  status: "active",
  notes: null,
});

describe("planDies: what the server check means for each row", () => {
  const ok = [die("40", "4012"), die("40", "4013"), die("50", "5001")];
  const okRows = [2, 3, 5];
  const check = {
    duplicates: [{ ...die("40", "4013"), existingId: "die-1" }],
    errors: [{ ...die("50", "5001"), error: "A deleted die uses this code" }],
  };

  test("skip: new dies only; rows held by a deleted die are rejected with their row number", () => {
    const plan = planDies(ok, okRows, check, "skip");
    expect(plan.ops).toEqual([{ row: 2, data: ok[0] }]);
    expect(plan.existing).toBe(1);
    expect(plan.blocked).toEqual([{ row: 5, reason: "imports.reason.deletedDie", column: "Section code" }]);
  });

  test("update: existing dies are sent with their id", () => {
    const plan = planDies(ok, okRows, check, "update", "Section code");
    expect(plan.ops).toEqual([
      { row: 2, data: ok[0] },
      { row: 3, data: ok[1], existingId: "die-1" },
    ]);
  });

  test("dieChunkInput splits a chunk into new and updated rows", () => {
    const plan = planDies(ok, okRows, check, "update");
    expect(dieChunkInput(plan.ops)).toEqual({
      newRows: [ok[0]],
      updatedRows: [{ ...ok[1], existingId: "die-1" }],
    });
  });
});
