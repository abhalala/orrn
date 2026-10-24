import { describe, expect, test } from "bun:test";

import { parseImport, type BundleImportRow, type DieImportRow } from "./parse";
import {
  chunkRequestId,
  dieChunkInput,
  IMPORT_INVALIDATES,
  importFailure,
  planBundles,
  planDies,
  runChunks,
  uniqueDies,
} from "./submit";

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
  weightMinG: 1000,
  weightMaxG: 1200,
  dimensions: {},
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

  test("a four-column sheet updates only the weight band: no name, notes, status or geometry is sent", () => {
    const parsed = parseImport(
      "dies",
      [{ Series: "PATTI", "Section code": "14701", "Min weight (kg/12ft)": "2.4", "Max weight (kg/12ft)": "2.6" }],
      { companyUnit: "inch" },
    );
    const plan = planDies(parsed.ok, parsed.okRows, { duplicates: [{ ...parsed.ok[0]!, existingId: "die-7" }], errors: [] }, "update");
    const input = dieChunkInput(plan.ops);
    expect(input.newRows).toEqual([]);
    // Exactly these keys: the server keeps every field that is not sent (an archived die stays archived).
    expect(input.updatedRows).toEqual([
      { existingId: "die-7", series: "PATTI", sectionCode: "14701", weightMinG: 2400, weightMaxG: 2600, dimensions: {} },
    ]);
    expect(Object.keys(input.updatedRows[0]!).sort()).toEqual(
      ["dimensions", "existingId", "sectionCode", "series", "weightMaxG", "weightMinG"].sort(),
    );
  });
});

const bundle = (series: string, code: string, quantity = 10): BundleImportRow => ({
  dieSeries: series,
  dieSectionCode: code,
  quantity,
  weightG: 25_000,
  lengthMm: 3658,
  poNumber: null,
});

describe("old bundles: dies deleted in orrn are problem rows before anything is saved", () => {
  test("uniqueDies sends each (series, section code) once", () => {
    expect(uniqueDies([bundle("L", "1"), bundle("L", "1", 5), bundle("L", "2"), bundle("M", "1")])).toEqual([
      { series: "L", sectionCode: "1" },
      { series: "L", sectionCode: "2" },
      { series: "M", sectionCode: "1" },
    ]);
  });

  test("planBundles rejects only the rows of a deleted die, with their sheet row number", () => {
    const ok = [bundle("L", "1"), bundle("L", "GONE"), bundle("M", "GONE"), bundle("L", "GONE", 3)];
    const plan = planBundles(ok, [2, 3, 5, 9], { deleted: [{ series: "L", sectionCode: "GONE" }] }, "Section");
    expect(plan.ops).toEqual([
      { row: 2, data: ok[0] },
      { row: 5, data: ok[2] },
    ]);
    expect(plan.blocked).toEqual([
      { row: 3, reason: "imports.reason.dieDeleted", column: "Section" },
      { row: 9, reason: "imports.reason.dieDeleted", column: "Section" },
    ]);
  });
});

describe("chunkRequestId: the same chunk always gets the same id", () => {
  const ops = [
    { row: 2, data: bundle("L", "1") },
    { row: 3, data: bundle("L", "2") },
  ];

  test("same kind and rows: same id, and it fits the server's rule (16-64 letters, digits, - or _)", async () => {
    const a = await chunkRequestId("bundles", ops);
    expect(a).toBe(await chunkRequestId("bundles", ops.map((o) => ({ ...o, data: { ...o.data } }))));
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });

  test("a different row, row number, kind or update target is a different request", async () => {
    const base = await chunkRequestId("bundles", ops);
    expect(await chunkRequestId("bundles", [ops[0]!, { row: 3, data: bundle("L", "2", 11) }])).not.toBe(base);
    expect(await chunkRequestId("bundles", [ops[0]!, { ...ops[1]!, row: 4 }])).not.toBe(base);
    expect(await chunkRequestId("customers", ops)).not.toBe(base);
    const d = [{ row: 2, data: die("1", "A") }];
    expect(await chunkRequestId("dies", d)).not.toBe(await chunkRequestId("dies", [{ ...d[0]!, existingId: "x" }]));
  });
});

describe("importFailure: what a failed call means for the rows in it", () => {
  test("no answer from the server: maybe saved, safe to try again", () => {
    expect(importFailure(new TypeError("Failed to fetch"))).toEqual({
      outcome: "unknown",
      message: "errors.network",
      retry: true,
    });
    expect(importFailure({ message: "aborted", data: null })).toMatchObject({ outcome: "unknown", retry: true });
  });

  test("a server failure (5xx) is maybe saved too, and never shows the server's own text", () => {
    for (const data of [
      { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
      { code: "TIMEOUT", httpStatus: 408 },
      { code: "BAD_GATEWAY", httpStatus: 502 },
      { code: "BAD_REQUEST", httpStatus: 503 },
    ]) {
      expect(importFailure({ message: "D1_ERROR: UNIQUE constraint failed", data })).toEqual({
        outcome: "unknown",
        message: "imports.failed.server",
        retry: true,
      });
    }
  });

  test("a refusal was not saved; retry only where trying again can work", () => {
    expect(importFailure({ data: { code: "TOO_MANY_REQUESTS", httpStatus: 429 } })).toEqual({
      outcome: "refused",
      message: "imports.failed.busy",
      retry: true,
    });
    expect(importFailure({ data: { code: "FORBIDDEN", httpStatus: 403 } })).toEqual({
      outcome: "refused",
      message: "errors.forbidden",
      retry: false,
    });
    expect(importFailure({ data: { code: "UNAUTHORIZED", httpStatus: 401 } })).toEqual({
      outcome: "refused",
      message: "errors.sessionExpired",
      retry: false,
    });
    // Server text is English and often a dead end ("Restore them from the dies page"): never shown.
    for (const code of ["BAD_REQUEST", "CONFLICT", "NOT_FOUND", "PAYLOAD_TOO_LARGE"]) {
      expect(importFailure({ message: "Dies previously deleted: 40 / 4012. Restore them…", data: { code, httpStatus: 400 } })).toEqual({
        outcome: "refused",
        message: "imports.failed.refused",
        retry: false,
      });
    }
  });
});

describe("IMPORT_INVALIDATES: lists refreshed after a run (saved rows are real even when a later call fails)", () => {
  test("each kind refreshes what it changed", () => {
    expect(IMPORT_INVALIDATES).toEqual({
      bundles: ["bundle", "die", "dashboard", "stock", "analytics"],
      dies: ["die"],
      customers: ["customer"],
    });
  });
});
