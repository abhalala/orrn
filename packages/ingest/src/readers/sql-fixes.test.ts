import { describe, expect, test } from "bun:test";

import { parseSql, sqlTablesToBlocks } from "./sql";

// Synthetic dumps for the review 1 findings. No real plant data.

const chunks = [1, 7, 64, 100_000];
const each = (sql: string, check: (r: ReturnType<typeof parseSql>) => void) => {
  for (const chunkSize of chunks) check(parseSql(sql, { chunkSize }));
};

describe("C11: tables are keyed by schema and name", () => {
  test("public.log and audit.log stay two tables, each with its own columns", () => {
    const sql = ["COPY public.log (id, msg) FROM stdin;", "1\thello", "\\.", "COPY audit.log (id, who, at) FROM stdin;", "7\tasha\tnoon", "\\.", ""].join("\n");
    each(sql, (r) => {
      expect(r.tables.map((t) => [t.schema, t.name, t.columns, t.rows])).toEqual([
        ["public", "log", ["id", "msg"], [["1", "hello"]]],
        ["audit", "log", ["id", "who", "at"], [["7", "asha", "noon"]]],
      ]);
      expect(sqlTablesToBlocks(r.tables).map((b) => b.sheetName)).toEqual(["public.log", "audit.log"]);
    });
  });

  test('quoted "Orders" and unquoted orders are different tables in Postgres', () => {
    const sql = 'INSERT INTO public."Orders" (a) VALUES (1);\nINSERT INTO public.orders (b) VALUES (2);\n';
    each(sql, (r) => expect(r.tables.map((t) => [t.name, t.columns])).toEqual([["Orders", ["a"]], ["orders", ["b"]]]));
  });

  test("CREATE TABLE in two schemas keeps each column list", () => {
    const sql = [
      "CREATE TABLE public.users (id int, name text);",
      "CREATE TABLE audit.users (id int, actor text, at text);",
      "INSERT INTO public.users VALUES (1, 'Asha');",
      "INSERT INTO audit.users VALUES (2, 'x', 'noon');",
      "",
    ].join("\n");
    each(sql, (r) => expect(r.tables.map((t) => t.columns)).toEqual([["id", "name"], ["id", "actor", "at"]]));
  });

  test("a bare name finds the one schema that declares it", () => {
    const sql = "CREATE TABLE public.things (id int, label text);\nINSERT INTO things VALUES (1, 'a');\n";
    each(sql, (r) => expect(r.tables.map((t) => t.columns)).toEqual([["id", "label"]]));
  });
});

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

