import { describe, expect, test } from "bun:test";

import { chunk, DIE_IMPORT_CHUNK_SIZE, IMPORT_CHUNK_SIZE, importChunkSize } from "./parse";

describe("import chunk size", () => {
  test("a die book goes in 2,000-row calls, the other sheets in 500", () => {
    expect(importChunkSize("dies")).toBe(2000);
    expect(DIE_IMPORT_CHUNK_SIZE).toBe(2000);
    expect(importChunkSize("bundles")).toBe(IMPORT_CHUNK_SIZE);
    expect(importChunkSize("customers")).toBe(500);
  });

  test("3,000 dies are two calls: 2,000 then 1,000", () => {
    const rows = Array.from({ length: 3000 }, (_, i) => i);
    expect(chunk(rows, importChunkSize("dies")).map((c) => c.length)).toEqual([2000, 1000]);
  });
});
