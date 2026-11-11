import { describe, expect, test } from "bun:test";

import { parseCopyLine, parseSql, sqlTablesToBlocks, SqlReader } from "./sql";

// Synthetic dumps with the syntax of the real ones. No real plant data.

const PG_COPY = [
  "--",
  "-- PostgreSQL database dump",
  "--",
  "\\restrict abc123",
  "",
  "SET statement_timeout = 0;",
  "SET standard_conforming_strings = on;",
  "SELECT pg_catalog.set_config('search_path', '', false);",
  "",
  '-- Data for Name: Thing; Type: TABLE DATA; Schema: public; Owner: x',
  "",
  'COPY public."Thing" (id, label, qty, note) FROM stdin;',
  "1\tAlpha\t10\t\\N",
  "2\tBeta 'quoted'\t20\tline one\\nline two",
  "3\tTab\\there\t30\tback\\\\slash",
  "4\t\t\t",
  "\\.",
  "",
  "COPY public._prisma_migrations (id, name) FROM stdin;",
  "m1\tinit",
  "\\.",
  "",
  'COPY public."soldThing" (sr_no, uid) FROM stdin;',
  "10\tU1",
  "11\tU2",
  "\\.",
  "",
  "SELECT pg_catalog.setval('public.\"Thing_id_seq\"', 4, true);",
  "\\unrestrict abc123",
  "",
].join("\n");

const PG_INSERTS = [
  "SET standard_conforming_strings = on;",
  `INSERT INTO public."Thing" VALUES (1, 'Alpha', 10, NULL);`,
  `INSERT INTO public."Thing" VALUES (2, 'O''Neil, Sons', 20.50, 'C:\\temp\\new');`,
  `INSERT INTO public."Thing" VALUES (3, E'tab\\there', 30, 'x'::text);`,
  `INSERT INTO other (a, b) VALUES ('1', 'two'), ('3', 'four');`,
  "",
].join("\n");

const MYSQL = [
  "-- MySQL dump 10.13  Distrib 8.0",
  "/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;",
  "DROP TABLE IF EXISTS `items`;",
  "CREATE TABLE `items` (",
  "  `id` int NOT NULL AUTO_INCREMENT,",
  "  `name` varchar(100) DEFAULT NULL,",
  "  `weight` decimal(10,2) DEFAULT NULL,",
  "  `memo` text,",
  "  PRIMARY KEY (`id`),",
  "  KEY `name_idx` (`name`)",
  ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
  "LOCK TABLES `items` WRITE;",
  "INSERT INTO `items` VALUES (1,'Rod',2.50,'it\\'s fine'),(2,'Bar, flat',NULL,'two\\nlines'),(3,'Tee',1.25,'back\\\\slash');",
  "INSERT INTO `items` VALUES (4,'Angle (L)',3.00,'semi; colon');",
  "UNLOCK TABLES;",
  "",
].join("\n");

function chunked(text: string, size: number) {
  const r = new SqlReader();
  for (let i = 0; i < text.length; i += size) r.push(text.slice(i, i + size));
  return r.finish();
}

describe("Postgres COPY blocks", () => {
  const r = parseSql(PG_COPY);
  test("tables and columns, quoted mixed-case names, schema kept", () => {
    expect(r.tables.map((t) => t.name)).toEqual(["Thing", "_prisma_migrations", "soldThing"]);
    expect(r.tables[0]!.schema).toBe("public");
    expect(r.tables[0]!.columns).toEqual(["id", "label", "qty", "note"]);
    expect(r.tables[0]!.source).toBe("copy");
  });
  test("tab separated rows, \\N is an empty cell, backslash escapes are undone", () => {
    expect(r.tables[0]!.rows).toEqual([
      ["1", "Alpha", "10", ""],
      ["2", "Beta 'quoted'", "20", "line one\nline two"],
      ["3", "Tab\there", "30", "back\\slash"],
      ["4", "", "", ""],
    ]);
    expect(r.tables[0]!.rowCount).toBe(4);
  });
  test("\\. ends the block; later statements, psql lines and setval are skipped; nothing unparsed", () => {
    expect(r.tables[2]!.rows).toEqual([["10", "U1"], ["11", "U2"]]);
    expect(r.unparsedCount).toBe(0);
  });
  test("parseCopyLine", () => {
    expect(parseCopyLine("a\\N\t\\N\t\\x41\\101")).toEqual(["aN", "", "AA"]);
  });
});

describe("Postgres INSERT dump", () => {
  const r = parseSql(PG_INSERTS);
  test("one row per statement, NULL, doubled quotes, literal backslashes, E strings, casts", () => {
    const t = r.tables.find((x) => x.name === "Thing")!;
    expect(t.rows).toEqual([
      ["1", "Alpha", "10", ""],
      ["2", "O'Neil, Sons", "20.50", "C:\\temp\\new"],
      ["3", "tab\there", "30", "x"],
    ]);
  });
  test("multi-row insert with a column list", () => {
    const t = r.tables.find((x) => x.name === "other")!;
    expect(t.columns).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["1", "two"], ["3", "four"]]);
    expect(r.unparsedCount).toBe(0);
  });
  test("columns of a table with no list come from a schema pushed first", () => {
    const rd = new SqlReader();
    rd.push('CREATE TABLE public."Thing" (\n  id integer NOT NULL,\n  label text,\n  qty integer,\n  note text,\n  CONSTRAINT "Thing_pkey" PRIMARY KEY (id)\n);\n');
    rd.push(PG_INSERTS);
    const t = rd.finish().tables.find((x) => x.name === "Thing")!;
    expect(t.columns).toEqual(["id", "label", "qty", "note"]);
  });
  test("with no schema the columns are col1..colN", () => {
    expect(r.tables.find((x) => x.name === "Thing")!.columns).toEqual(["col1", "col2", "col3", "col4"]);
  });
});

describe("MySQL dump", () => {
  const r = parseSql(MYSQL);
  test("CREATE TABLE gives the columns and skips keys; multi-row insert with backslash escapes", () => {
    expect(r.tables.length).toBe(1);
    const t = r.tables[0]!;
    expect(t.name).toBe("items");
    expect(t.columns).toEqual(["id", "name", "weight", "memo"]);
    expect(t.rows).toEqual([
      ["1", "Rod", "2.50", "it's fine"],
      ["2", "Bar, flat", "", "two\nlines"],
      ["3", "Tee", "1.25", "back\\slash"],
      ["4", "Angle (L)", "3.00", "semi; colon"],
    ]);
    expect(r.unparsedCount).toBe(0);
  });
});

describe("push-based: chunk size changes nothing", () => {
  for (const [label, text] of [["copy", PG_COPY], ["inserts", PG_INSERTS], ["mysql", MYSQL]] as const) {
    test(`${label}: 1, 2, 5, 13 and 64 character chunks give the same tables`, () => {
      const whole = parseSql(text);
      for (const size of [1, 2, 5, 13, 64]) {
        const c = chunked(text, size);
        expect(c.tables).toEqual(whole.tables);
        expect(c.unparsedCount).toBe(whole.unparsedCount);
      }
    });
  }
});

describe("limits and bad input", () => {
  test("rows past the cap are counted and dropped, and the table is flagged", () => {
    const rows = Array.from({ length: 50 }, (_, i) => `(${i}, 'r${i}')`).join(",");
    const r = parseSql(`INSERT INTO t (a, b) VALUES ${rows};`, { maxRows: 10 });
    expect(r.tables[0]!.rows.length).toBe(10);
    expect(r.tables[0]!.rowCount).toBe(50);
    expect(r.tables[0]!.truncated).toBe(true);
    expect(r.truncated).toBe(true);
  });
  test("a row with the wrong number of cells is kept and counted", () => {
    const r = parseSql("INSERT INTO t (a, b) VALUES (1, 2), (3);");
    expect(r.tables[0]!.arityMismatch).toBe(1);
    expect(r.tables[0]!.rows.length).toBe(2);
  });
  test("a broken statement is reported with its line and the reader goes on", () => {
    const r = parseSql("INSERT INTO t (a) VALUES (1);\nINSERT INTO t (a) VALUES (2 3);\nINSERT INTO t (a) VALUES (4);\n");
    expect(r.unparsedCount).toBeGreaterThan(0);
    expect(r.unparsed[0]!.line).toBe(2);
    expect(r.tables[0]!.rows.map((x) => x[0])).toEqual(["1", "4"]);
  });
  test("an unfinished row at the end is reported", () => {
    const r = parseSql("INSERT INTO t (a) VALUES (1), ('abc");
    expect(r.tables[0]!.rows).toEqual([["1"]]);
    expect(r.unparsedCount).toBe(1);
  });
  test("COPY from a file path has no data and is reported", () => {
    const r = parseSql("COPY t (a) FROM '/tmp/x.csv';\nSELECT 1;\n");
    expect(r.tables.length).toBe(0);
    expect(r.unparsedCount).toBe(1);
  });
  test("a long function body with semicolons and quotes in it is skipped as one statement", () => {
    const r = parseSql("CREATE FUNCTION f() RETURNS int AS $$ BEGIN RETURN 'a;b'; END; $$ LANGUAGE plpgsql;\nINSERT INTO t (a) VALUES (1);\n");
    expect(r.tables[0]!.rows).toEqual([["1"]]);
  });
  test("comments and semicolons inside strings do not end a statement", () => {
    const r = parseSql("-- note; here\nINSERT INTO t (a, b) VALUES ('x; -- y', /* c */ 'z');\n");
    expect(r.tables[0]!.rows).toEqual([["x; -- y", "z"]]);
  });
});

describe("to blocks", () => {
  test("a table is a block named after it; empty tables are left out", () => {
    const r = parseSql(PG_COPY + "\nCOPY public.empty (a) FROM stdin;\n\\.\n");
    const blocks = sqlTablesToBlocks(r.tables);
    expect(blocks.map((b) => b.sheetName)).toEqual(["Thing", "_prisma_migrations", "soldThing"]);
    expect(blocks[0]!.headers).toEqual(["id", "label", "qty", "note"]);
  });
});
