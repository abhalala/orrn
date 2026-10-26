import { expect, test } from "bun:test";

import { pushChunkedInserts } from "@orrn/db/atomic";
import { chunk, mapInChunks, rowsPerStatement } from "@orrn/db/chunk";

test("rowsPerStatement derives rows from column count", () => {
  expect(rowsPerStatement(12)).toBe(8);
  expect(rowsPerStatement(8)).toBe(12);
  expect(rowsPerStatement(9)).toBe(11);
  expect(rowsPerStatement(4)).toBe(25);
  expect(rowsPerStatement(150)).toBe(1);
  expect(rowsPerStatement(5, 50)).toBe(10);
});

test("chunk splits into slices of at most size", () => {
  expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  expect(chunk([], 3)).toEqual([]);
  expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
});

test("mapInChunks concatenates per-chunk results and chunks at 90 ids", async () => {
  const sizes: number[] = [];
  const out = await mapInChunks(Array.from({ length: 200 }, (_, i) => i), async (ids) => {
    sizes.push(ids.length);
    return ids;
  });
  expect(sizes).toEqual([90, 90, 20]);
  expect(out).toHaveLength(200);
});

test("pushChunkedInserts sizes chunks from the row's column count", () => {
  const sizes: number[] = [];
  const out: never[] = [];
  const rows = Array.from({ length: 30 }, (_, i) => ({ a: i, b: 1, c: 2, d: 3, e: 4, f: 5, g: 6, h: 7 }));
  pushChunkedInserts(out as never, (part) => {
    sizes.push(part.length);
    return {} as never;
  }, rows);
  expect(sizes).toEqual([12, 12, 6]);
  for (const s of sizes) expect(s * 8).toBeLessThanOrEqual(100);
  pushChunkedInserts(out as never, () => ({}) as never, []);
  expect(sizes).toHaveLength(3);
});
