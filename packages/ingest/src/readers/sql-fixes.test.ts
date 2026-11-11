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

describe("C12: a later statement with another column list lands under the right headers", () => {
  test("INSERT (a,b) then (b,a)", () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 2);\nINSERT INTO t (b, a) VALUES (3, 4);\n";
    each(sql, (r) => {
      expect(r.tables[0]!.columns).toEqual(["a", "b"]);
      expect(r.tables[0]!.rows).toEqual([["1", "2"], ["4", "3"]]);
      expect(r.tables[0]!.columnListChanges).toBe(1);
    });
  });

  test("a new column is added and earlier rows are padded", () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 2);\nINSERT INTO t (a, c) VALUES (3, 5);\n";
    each(sql, (r) => {
      expect(r.tables[0]!.columns).toEqual(["a", "b", "c"]);
      expect(r.tables[0]!.rows).toEqual([["1", "2", ""], ["3", "", "5"]]);
    });
  });

  test("COPY with a reordered list", () => {
    const sql = ["COPY t (a, b) FROM stdin;", "1\t2", "\\.", "COPY t (b, a) FROM stdin;", "3\t4", "\\.", ""].join("\n");
    each(sql, (r) => expect(r.tables[0]!.rows).toEqual([["1", "2"], ["4", "3"]]));
  });

  test("the same list in another case is not a change", () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 2);\nINSERT INTO t (A, B) VALUES (3, 4);\n";
    each(sql, (r) => {
      expect(r.tables[0]!.rows).toEqual([["1", "2"], ["3", "4"]]);
      expect(r.tables[0]!.columnListChanges).toBe(0);
    });
  });
});

describe("C13: one unreadable value loses one row, not the rest of the statement", () => {
  test("an odd value in row 2 keeps rows 1 and 3 and counts one unparsed row", () => {
    const sql = "INSERT INTO t (a, b) VALUES (1, 'x'), (2, bad value here), (3, 'z');\nINSERT INTO t (a, b) VALUES (4, 'w');\n";
    each(sql, (r) => {
      expect(r.tables[0]!.rows).toEqual([["1", "x"], ["3", "z"], ["4", "w"]]);
      expect(r.tables[0]!.rowCount).toBe(4);
      expect(r.unparsedCount).toBe(1);
    });
  });

  test("_binary 'x' with a space, DATE '...' and TIMESTAMP '...' are read", () => {
    const sql = "INSERT INTO t (a, b, c) VALUES (_binary 'ab', DATE '2020-01-01', TIMESTAMP '2020-01-01 10:00:00');\n";
    each(sql, (r) => {
      expect(r.tables[0]!.rows).toEqual([["ab", "2020-01-01", "2020-01-01 10:00:00"]]);
      expect(r.unparsedCount).toBe(0);
    });
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

describe("C30: column names that look like constraint words", () => {
  test("key, index, period, like and check are columns when a type follows", () => {
    const sql = [
      "CREATE TABLE public.settings (key text, value text, index integer, period text, \"like\" text, check_no int,",
      "  CONSTRAINT settings_pkey PRIMARY KEY (key), UNIQUE (value), KEY idx_v (value), CHECK (index > 0));",
      "INSERT INTO public.settings VALUES ('a', 'b', 1, 'p', 'l', 2);",
      "",
    ].join("\n");
    each(sql, (r) => expect(r.tables[0]!.columns).toEqual(["key", "value", "index", "period", "like", "check_no"]));
  });

  test("MySQL KEY and UNIQUE KEY lines are not columns", () => {
    const sql = ["CREATE TABLE `t` (", "  `id` int,", "  `code` varchar(20),", "  PRIMARY KEY (`id`),", "  UNIQUE KEY `u_code` (`code`),", "  KEY `k_code` (`code`)", ") ENGINE=InnoDB;", "INSERT INTO `t` VALUES (1,'a');", ""].join("\n");
    each(sql, (r) => expect(r.tables[0]!.columns).toEqual(["id", "code"]));
  });
});

describe("C31: casts after raw values", () => {
  test("1.50::numeric is 1.50 and NULL::text and NULL::character varying are empty", () => {
    const sql = "INSERT INTO t (a, b, c, d) VALUES (1, 1.50::numeric, NULL::text, NULL::character varying);\n";
    each(sql, (r) => {
      expect(r.tables[0]!.rows).toEqual([["1", "1.50", "", ""]]);
      expect(r.unparsedCount).toBe(0);
    });
  });
});

