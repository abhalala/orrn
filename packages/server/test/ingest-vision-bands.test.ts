/**
 * Vision read, contract section 11.3: bands for dense pages. The pure merge (`mergeBands`), the pick of
 * band 1's banded table, and the call and cost arithmetic of the caps. Synthetic tables only.
 */
import { describe, expect, test } from "bun:test";

import "./env-mock";

import { VISION_PARAMS } from "@orrn/ingest";
import { BLOCK_CALL_CAP, DAY_CALL_CAP, DAY_COST_CAP_MICRO, type VisionTable } from "../src/lib/ingest/bot";
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
    expect(mergeBands([t(rowsFrom(1, 2))], [[]])).toBeNull();
    expect(mergeBands([], [])).toBeNull();
  });
});

describe("cap arithmetic (contract section 11.3)", () => {
  const pages = VISION_PARAMS.maxPagesPerFile;
  const k = VISION_PARAMS.maxBandsPerPage;
  test("one key never meets its cap: a call and one retry per band", () => {
    expect(1 + 1).toBeLessThanOrEqual(BLOCK_CALL_CAP);
  });
  test("calls per file stay under the day cap", () => {
    // Whole pages only, a retry each.
    expect(pages * 2).toBe(60);
    // Every page a dense text PDF at 3 bands, a retry each.
    expect(pages * 3).toBe(90);
    expect(pages * 3 * 2).toBe(180);
    // Every page a dense scan: one whole read and 3 bands, a retry each.
    expect(pages * (1 + 3)).toBe(120);
    expect(pages * (1 + 3) * 2).toBe(240);
    expect(pages * (1 + 3) * 2).toBeLessThanOrEqual(DAY_CALL_CAP);
    // The most bands one page may have still fits a 30 page scan with no retries.
    expect(pages * (1 + k)).toBeLessThanOrEqual(DAY_CALL_CAP);
  });
  test("cost: 90 band calls at about 0.07 USD pass the 5 USD day cap near call 70", () => {
    const perBandMicro = 60_000 + 10_000;
    expect(90 * perBandMicro).toBe(6_300_000);
    expect(90 * perBandMicro).toBeGreaterThan(DAY_COST_CAP_MICRO);
    expect(Math.ceil(DAY_COST_CAP_MICRO / perBandMicro)).toBe(72);
  });
});
