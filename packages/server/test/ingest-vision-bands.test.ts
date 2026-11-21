/**
 * Vision read, contract section 11.3: bands for dense pages. The pure merge (`mergeBands`), the pick of
 * band 1's banded table, and the call and cost arithmetic of the caps. Synthetic tables only.
 */
import { describe, expect, test } from "bun:test";

import "./env-mock";

import { VISION_PARAMS } from "@orrn/ingest";
import { BLOCK_CALL_CAP, DAY_CALL_CAP, fakeResponse, FakeShapeClient, MemoryBotRunStore, runVisionAttempt, type RunVisionArgs, type VisionTable } from "../src/lib/ingest/bot";
import { bandedTableIndex, mergeBands } from "../src/lib/ingest/vision";

const H = ["Section", "Bundles", "Kg"];
const rowsFrom = (from: number, n: number) => Array.from({ length: n }, (_, i) => [`S${from + i}`, String(from + i), `${(from + i) * 3}`]);
const t = (rows: string[][], over: Partial<VisionTable> = {}): VisionTable => ({
  title: null,
  headers: H,
  rows,
  rowConfidence: rows.map(() => 0.9),
  lowConfidenceRows: [],
  ...over,
});

describe("bandedTableIndex", () => {
  test("the table with the most rows, the last one on a tie", () => {
    expect(bandedTableIndex([t(rowsFrom(1, 2)), t(rowsFrom(1, 60)), t(rowsFrom(1, 3))])).toBe(1);
    expect(bandedTableIndex([t(rowsFrom(1, 5)), t(rowsFrom(1, 5))])).toBe(1);
    expect(bandedTableIndex([t([])])).toBe(0);
  });
});

describe("mergeBands", () => {
  test("rows are concatenated in band order: none duplicated, none dropped at any edge", () => {
    const m = mergeBands([t(rowsFrom(1, 65))], [[t(rowsFrom(66, 65))], [t(rowsFrom(131, 65))], [t(rowsFrom(196, 64))]]);
    expect(m).not.toBeNull();
    const rows = m!.tables[0]!.rows;
    expect(rows).toHaveLength(259);
    expect(rows.map((r) => r[0])).toEqual(rowsFrom(1, 259).map((r) => r[0]));
    expect(new Set(rows.map((r) => r[0])).size).toBe(259);
    expect(m!.tables[0]!.rowConfidence).toHaveLength(259);
  });

  test("a first row of band k >= 2 equal to the headers is dropped once; a header-like row elsewhere stays", () => {
    const strip = [" section ", "BUNDLES", "Kg"];
    const m = mergeBands([t(rowsFrom(1, 2))], [[t([strip, strip, ...rowsFrom(3, 2)])], [t([...rowsFrom(5, 1), H])]]);
    const rows = m!.tables[0]!.rows;
    // Band 2: only its first row goes. Band 3: the header-like row is not first, so it stays.
    expect(rows).toEqual([...rowsFrom(1, 2), strip, ...rowsFrom(3, 2), ...rowsFrom(5, 1), H]);
    // Band 1's own first row is never dropped.
    expect(mergeBands([t([H, ...rowsFrom(1, 1)])], [])!.tables[0]!.rows).toEqual([H, ...rowsFrom(1, 1)]);
  });

  test("confidences follow their rows across the drop, and low rows are counted on the merged table", () => {
    const b2 = t([H, ...rowsFrom(3, 2)], { rowConfidence: [0.1, 0.5, 0.95] });
    const m = mergeBands([t(rowsFrom(1, 2), { rowConfidence: [0.9, 0.6] })], [[b2]]);
    expect(m!.tables[0]!.rowConfidence).toEqual([0.9, 0.6, 0.5, 0.95]);
    expect(m!.tables[0]!.lowConfidenceRows).toEqual([2, 1]);
  });

  test("band 1's other tables stay as their own tables, in place", () => {
    const title = t([["Stock as on", "31.10.2025", ""]], { headers: ["A", "B", "C"], title: "Head" });
    const totals = t([["Total", "", ""]], { headers: ["A", "B", "C"] });
    const m = mergeBands([title, t(rowsFrom(1, 60)), totals], [[t(rowsFrom(61, 10))]]);
    expect(m!.banded).toBe(1);
    expect(m!.tables).toHaveLength(3);
    expect(m!.tables[0]).toEqual(title);
    expect(m!.tables[2]).toEqual(totals);
    expect(m!.tables[1]!.rows).toHaveLength(70);
  });

  test("widths are checked: a later band of another width, a short row, or two tables is refused", () => {
    expect(mergeBands([t(rowsFrom(1, 2))], [[t([["S3", "3"]], { headers: ["Section", "Bundles"] })]])).toBeNull();
    expect(mergeBands([t(rowsFrom(1, 2))], [[t([["S3", "3"]])]])).toBeNull();
    expect(mergeBands([t(rowsFrom(1, 2))], [[t(rowsFrom(3, 1)), t(rowsFrom(4, 1))]])).toBeNull();
    expect(mergeBands([], [])).toBeNull();
  });

  test("S4: a later band with no table (a footer strip) adds no rows; the other bands still merge", () => {
    const merged = mergeBands([t(rowsFrom(1, 2))], [[t(rowsFrom(3, 2))], []]);
    expect(merged!.tables[0]!.rows).toEqual(rowsFrom(1, 4));
    expect(mergeBands([t(rowsFrom(1, 2))], [[]])!.tables[0]!.rows).toEqual(rowsFrom(1, 2));
  });
});

/**
 * Contract section 11.3, calls and caps, through the real `runVisionAttempt` and the real caps (N14: these
 * tests used to add up numbers written into the test). Each run key has its own 4-call cap; a whole file's
 * calls stay under the day call cap.
 */
describe("caps of a banded file (contract section 11.3)", () => {
  const pages = VISION_PARAMS.maxPagesPerFile;
  const CHEAP = { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 };
  const S = "claude-sonnet-5-5";
  const valid = () => fakeResponse({ tables: [{ title: null, headers: H, rows: [{ cells: ["S1", "1", "3"], confidence: 0.9 }] }] }, { modelUsed: S, usage: CHEAP });
  const invalid = () => fakeResponse({ tables: [{ title: null, headers: H, rows: [{ cells: ["S1"], confidence: 0.9 }] }] }, { modelUsed: S, usage: CHEAP });
  const at = Date.UTC(2026, 10, 10, 6, 0, 0);
  const run = (store: MemoryBotRunStore, blockId: string, client: FakeShapeClient, band: RunVisionArgs["band"] = null) =>
    runVisionAttempt({ env: { ANTHROPIC_API_KEY: "sk-test" }, store, companyId: "co1", userId: "u1", blockId, pageKind: "pdf_scan", page: { mediaType: "image/jpeg", bytes: new Uint8Array([1, 2, 3]) }, vaultReady: true, visualReads: true, band, client, nowMs: () => at });

  test("one key never meets its cap: an invalid answer and its retry are two of the key's four calls", async () => {
    const store = new MemoryBotRunStore();
    const client = new FakeShapeClient([invalid(), valid()]);
    expect(await run(store, "a:p1:b2", client, { index: 2, total: 3, headers: H })).toMatchObject({ status: "ran", outcome: "invalid", next: "retry" });
    expect(await run(store, "a:p1:b2", client, { index: 2, total: 3, headers: H })).toMatchObject({ status: "ran", outcome: "recipe", next: "done" });
    expect(store.rows.map((r) => r.outcome)).toEqual(["invalid", "recipe"]);
    // The key still has room under its own cap: a third run is refused as done, not as capped.
    expect(await run(store, "a:p1:b2", client)).toMatchObject({ status: "skipped", reason: "already_done" });
    expect(store.rows.filter((r) => r.outcome !== "capped").length).toBeLessThan(BLOCK_CALL_CAP);
  });

  test("a whole file of dense scans, one whole read and 3 bands a page, a retry each, stays under the day call cap", async () => {
    const store = new MemoryBotRunStore();
    const client = new FakeShapeClient(Array.from({ length: pages * 4 }, () => [invalid(), valid()]).flat());
    let capped = 0;
    for (let p = 1; p <= pages; p++) {
      for (const key of [`a:p${p}`, `a:p${p}:b1`, `a:p${p}:b2`, `a:p${p}:b3`]) {
        for (let i = 0; i < 2; i++) {
          const r = await run(store, key, client);
          if (r.status === "ran" && r.outcome === "capped") capped++;
        }
      }
    }
    expect(capped).toBe(0);
    const day = await store.dayTotals({ companyId: "co1", sinceMs: 0 });
    expect(day.calls).toBe(pages * 4 * 2);
    expect(day.calls).toBeLessThanOrEqual(DAY_CALL_CAP);
  });
});
