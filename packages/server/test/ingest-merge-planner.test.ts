/**
 * Infinity Portal merge planner, pure parts (plan A5): the chunk id is the same for the same rows and
 * changes with them; runs split at the size limit and where creates turn into updates; orders keep
 * their rows together and pack at most 10 orders per chunk.
 */
import { describe, expect, test } from "bun:test";

import { chunkIdOf, cutOrderRuns, cutRuns, pickOrderRows } from "../src/lib/ingest/merge/planner";
import { failureOf, fileRowsIn, INTERNAL_MESSAGE, orderKeyOf, type StagedRow } from "../src/lib/ingest/merge/shared";

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

  test("an order is never cut: 25 interleaved orders pack 10 whole orders per chunk (B1, B5)", () => {
    const r = rows(75, "ready_create", (i) => `o${i % 25}`);
    const runs = cutOrderRuns(r);
    expect(runs.map((x) => new Set(x.map((y) => y.group)).size)).toEqual([10, 10, 5]);
    for (const run of runs) {
      for (const g of new Set(run.map((x) => x.group))) expect(r.filter((x) => x.group === g).every((x) => run.includes(x))).toBe(true);
    }
  });

  test("the write step picks a chunk's whole orders back out of a shared range", () => {
    const staged = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, rowIndex: i, values: { customer: "c", poNumber: `P${i % 3}`, _ids: {} } }) as unknown as StagedRow);
    // Orders P0 (rows 0, 3), P1 (1, 4), P2 (2, 5). A chunk of 4 rows takes P0 and P1 whole.
    expect(pickOrderRows(staged, 4).map((s) => s.id)).toEqual(["s0", "s1", "s3", "s4"]);
    // After they are written only P2 is left in the range.
    expect(pickOrderRows(staged.filter((s) => s.rowIndex % 3 === 2), 2).map((s) => s.id)).toEqual(["s2", "s5"]);
  });

  // Changed by portal rules round 3, section 1: an old order is the financial year, the customer
  // and the old order number; the PO is never part of it. With no number, customer and PO.
  test("the order key: old order no and financial year, never the PO; with no number, PO ignoring case, spaces and date", () => {
    const k = (v: Record<string, unknown>) => orderKeyOf({ _ids: { customer: "c1" }, ...v });
    expect(k({ poNumber: " PO-1 ", orderDate: "2025-01-01" })).toBe(k({ poNumber: "po-1", orderDate: "2025-02-01" }));
    expect(k({ oldOrderNo: "B-1", orderDate: "2025-01-01" })).toBe(k({ oldOrderNo: "b-01", orderDate: "2025-01-02" }));
    expect(k({ oldOrderNo: "B-1", orderDate: "2025-03-31" })).not.toBe(k({ oldOrderNo: "B-1", orderDate: "2025-04-01" }));
    expect(k({ oldOrderNo: "B-1", poNumber: "PO-9", orderDate: "2025-05-01" })).toBe(k({ oldOrderNo: "B-1", orderDate: "2025-05-01" }));
    expect(k({ poNumber: "", oldOrderNo: "B-1" })).toBe(k({ oldOrderNo: "B-1" }));
  });
});

describe("failure messages", () => {
  test("an internal error is never stored as it came: no SQL, no bound values (Bm3)", () => {
    const f = failureOf(new Error("Failed query: select * from customer where tax_id = ?\nparams: 24ABCDE1234F1Z5"));
    expect(f).toEqual({ code: "INTERNAL_SERVER_ERROR", message: INTERNAL_MESSAGE, reason: "merge_failed" });
  });

  test("a refusal names the file row, not the place in the call (Bm2)", () => {
    const row = (rowIndex: number) => ({ id: `r${rowIndex}`, rowIndex }) as unknown as StagedRow;
    const sent = { rows: [row(500), row(537)], newRows: [row(3)], updatedRows: [row(9)] };
    expect(fileRowsIn("rows.1.email: Invalid email; newRows.0.weightMinG: Too small", sent)).toBe("File row 538, email: Invalid email; File row 4, weightMinG: Too small");
    expect(fileRowsIn("updatedRows.0: Not found", sent)).toBe("File row 10: Not found");
    expect(fileRowsIn("rows.7.email: x", sent)).toBe("rows.7.email: x");
  });
});
