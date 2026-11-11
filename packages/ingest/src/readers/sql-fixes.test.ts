import { describe, expect, test } from "bun:test";

import { parseSql, sqlTablesToBlocks } from "./sql";

// Synthetic dumps for the review 1 findings. No real plant data.

const chunks = [1, 7, 64, 100_000];
const each = (sql: string, check: (r: ReturnType<typeof parseSql>) => void) => {
  for (const chunkSize of chunks) check(parseSql(sql, { chunkSize }));
};

describe("C22: advancing over a long one-line insert stays linear", () => {
  test("50,000 rows on one line, 1 MB chunks, finish quickly with the right line count", () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => `(${i},'name ${i}')`).join(",");
    const sql = `INSERT INTO t (id, name) VALUES ${rows};\nINSERT INTO t (id, name) VALUES (x y);\n`;
    const started = performance.now();
    const r = parseSql(sql, { chunkSize: 1 << 20 });
    // The quadratic scan took about 440 ms here; the linear one about 15 ms.
    expect(performance.now() - started).toBeLessThan(200);
    expect(r.tables[0]!.rows.length).toBe(50_000);
    expect(r.unparsed[0]!.line).toBe(2);
  });
});

