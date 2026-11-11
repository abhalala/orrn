import { describe, expect, test } from "bun:test";

import { readSheet, toCellText } from "./blocks";
import type { BlockHints, MatrixCell, ReadBlock } from "./types";

// PORTAL-RULES-3 section 3, the acceptance property for sheets and CSV. Generated sheets with titles, letterheads,
// group labels, two-row headers, blank header cells, ragged rows, footers, wrapped cells, a second table and words in
// number columns, alone and together. A block the reader calls sure must equal the generated table exactly, and with
// the right hints every block must. No real plant data.

type Truth = { title: string | null; headers: string[]; rows: string[][]; hints: BlockHints };
type Case = { matrix: MatrixCell[][]; tables: Truth[]; features: string[] };

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

type Kind = "sr" | "party" | "section" | "int" | "dec" | "date" | "remark";
const POOL: { name: string; kind: Kind }[] = [
  { name: "Sr", kind: "sr" },
  { name: "Party", kind: "party" },
  { name: "Section", kind: "section" },
  { name: "Qty", kind: "int" },
  { name: "Kg", kind: "dec" },
  { name: "Date", kind: "date" },
  { name: "Rate", kind: "int" },
  { name: "Remarks", kind: "remark" },
];
const PARTIES = ["Om Metals", "Shree Ganesh", "Zenith Traders", "Asha Ent", "Kamal Bros"];
const SECTIONS = ["R 2105", "T 4012", "K 1100", "R 2106"];
const WORDS = ["Cancelled", "Pending", "not given", "see note"];

/** Every feature the generator can switch on. The report counts unsure blocks per feature. */
export const SHEET_FEATURES = [
  "title",
  "letterhead",
  "group_labels",
  "two_row_header",
  "blank_header_cell",
  "ragged_row",
  "footer",
  "total_row",
  "wrapped_cell",
  "second_table",
  "word_in_number",
  "leading_blank_rows",
  "gap_row",
] as const;
type Feature = (typeof SHEET_FEATURES)[number];

const seedMix = (rnd: (n: number) => number) => rnd(11);

function value(rnd: (n: number) => number, kind: Kind, r: number): MatrixCell {
  switch (kind) {
    case "sr":
      return r + 1;
    case "party":
      return PARTIES[rnd(PARTIES.length)]!;
    case "section":
      return SECTIONS[rnd(SECTIONS.length)]!;
    case "int":
      return 1 + rnd(999);
    case "dec":
      return (10 + rnd(99000)) / 100;
    case "date":
      return `${1 + rnd(28)}/${1 + rnd(12)}/2025`;
    case "remark":
      return rnd(3) === 0 ? "ok" : "";
  }
}

/** One table at `at` in the matrix. Returns its truth with raw row numbers. */
function table(rnd: (n: number) => number, m: MatrixCell[][], on: Set<Feature>, last: boolean): Truth {
  const width = 3 + rnd(4);
  // A key column first (Party or Sr), as real sheets have, then other columns; at least one holds numbers.
  const key = POOL[rnd(2)]!;
  const rest = POOL.filter((c) => c !== key && c.name !== "Party" && c.name !== "Sr");
  const others = [...rest].sort((x, y) => ((POOL.indexOf(x) * 7 + seedMix(rnd)) % 11) - ((POOL.indexOf(y) * 7 + seedMix(rnd)) % 11));
  const cols: { name: string; kind: Kind }[] = [key, ...others.slice(0, width - 1)];
  if (key.name === "Sr" && rnd(2) === 0) cols.splice(1, 0, POOL[1]!);
  if (!cols.some((c) => c.kind === "int" || c.kind === "dec")) cols.push({ name: "Qty", kind: "int" });

  const titleParts: string[] = [];
  if (on.has("letterhead")) {
    // A company name and a second cell: spread over the columns (and past them), or in two cells side by side.
    const spread = rnd(2) === 0;
    const row: MatrixCell[] = Array(spread ? cols.length + rnd(2) : 2).fill("");
    row[0] = ["FOURCUBES EXTRUSIONS", "Despatch Register 2025-26", "Sales Book"][rnd(3)]!;
    row[row.length - 1] = ["Plant 2", "Fourcubes Extrusions", "FY 2025-26", "as on 31.10.2025"][rnd(4)]!;
    m.push(row);
    titleParts.push(row.filter((c) => c !== "").join(" "));
  }
  if (on.has("title")) {
    const t = ["PENDING ORDER LIST AS ON 31.10.2025", "Stock statement", "Party: Om Metals"][rnd(3)]!;
    m.push([t]);
    titleParts.push(t);
  }

  // Header: one row, or a group-label row over sub-columns, or a two-row header with Min and Max under one name.
  let top: string[] = cols.map((c) => c.name);
  let bottom: string[] | null = null;
  let headers = [...top];
  if (on.has("group_labels")) {
    const subs = ["Kg", "Pcs"];
    const months = rnd(2) === 0 ? ["Apr 2025"] : ["Apr 2025", "May 2025"];
    const left = cols.filter((c) => c.kind === "party" || c.kind === "sr").slice(0, 1);
    const key = left[0] ?? { name: "Party", kind: "party" as Kind };
    cols.splice(0, cols.length, key, ...months.flatMap(() => subs.map((s) => ({ name: s, kind: (s === "Kg" ? "dec" : "int") as Kind }))));
    top = [key.name, ...months.flatMap((mo) => [mo, ""])];
    bottom = ["", ...months.flatMap(() => subs)];
    headers = [key.name, ...months.flatMap((mo) => subs.map((s) => `${mo} ${s}`))];
  } else if (on.has("two_row_header")) {
    const at = cols.findIndex((c) => c.kind === "int" || c.kind === "dec");
    const name = cols[at]!.name;
    cols.splice(at, 1, { name: "Min", kind: "dec" }, { name: "Max", kind: "dec" });
    top = cols.map((c) => (c.name === "Min" ? name : c.name === "Max" ? "" : c.name));
    bottom = cols.map((c) => (c.name === "Min" || c.name === "Max" ? c.name : ""));
    headers = cols.map((c) => (c.name === "Min" || c.name === "Max" ? `${name} ${c.name}` : c.name));
  }
  if (on.has("blank_header_cell")) {
    if (bottom) {
      // Under a two-row header the unnamed column goes after the groups, so no group label is lost.
      cols.push({ name: "", kind: "int" });
      top.push("");
      bottom.push("");
      headers.push("");
    } else {
      const blankAt = 1 + rnd(cols.length - 1);
      top[blankAt] = "";
      headers[blankAt] = "";
    }
  }
  const headerRow = m.length;
  m.push(top);
  if (bottom) m.push(bottom);
  const firstDataRow = m.length;

  const rows: MatrixCell[][] = [];
  const n = 2 + rnd(10);
  for (let r = 0; r < n; r++) rows.push(cols.map((c) => value(rnd, c.kind, r)));
  if (on.has("word_in_number")) {
    const numCols = cols.map((c, i) => (c.kind === "int" || c.kind === "dec" ? i : -1)).filter((i) => i >= 0);
    rows[rnd(Math.min(3, rows.length))]![numCols[rnd(numCols.length)]!] = WORDS[rnd(WORDS.length)]!;
  }
  if (on.has("wrapped_cell")) {
    const t = cols.findIndex((c) => c.kind === "party" || c.kind === "section");
    if (t >= 0) rows[rnd(rows.length)]![t] = `${String(rows[0]![t])}\nlong`;
  }
  if (on.has("ragged_row")) rows[rnd(rows.length)]!.push("vip");
  if (on.has("gap_row") && rows.length > 2) rows.splice(1 + rnd(rows.length - 2), 0, []);
  if (on.has("total_row")) {
    const total: MatrixCell[] = cols.map((c) => (c.kind === "dec" ? 999.5 : ""));
    total[cols.findIndex((c) => c.kind !== "dec")] = "TOTAL";
    rows.push(total);
  }
  m.push(...rows);
  const lastDataRow = m.length - 1;
  if (on.has("footer") && last) m.push([], ["Prepared by", "", "Checked by"]);

  const text = rows.map((r) => r.map(toCellText));
  const wide = text.reduce((w, r) => Math.max(w, r.length), headers.length);
  const allHeaders = [...headers, ...Array<string>(wide - headers.length).fill("")];
  // A last column with no name and no value is no column.
  let used = allHeaders.length;
  while (used > 0 && allHeaders[used - 1] === "" && text.every((r) => (r[used - 1] ?? "") === "")) used--;
  return {
    title: titleParts.length > 0 ? titleParts.join(" ") : null,
    headers: allHeaders.slice(0, used),
    rows: text.map((r) => r.slice(0, used)),
    hints: { headerRow, headerRows: bottom ? 2 : 1, firstDataRow, lastDataRow },
  };
}

export function generateSheet(seed: number, force?: Feature[]): Case {
  const rnd = rng(seed);
  const on = new Set<Feature>();
  if (force) for (const f of force) on.add(f);
  else {
    // Real-looking mixes: each feature on with its own chance; about one sheet in five is a plain table.
    const chance: Record<Feature, number> = {
      title: 3, letterhead: 6, group_labels: 10, two_row_header: 12, blank_header_cell: 10, ragged_row: 15, footer: 6,
      total_row: 5, wrapped_cell: 8, second_table: 8, word_in_number: 8, leading_blank_rows: 6, gap_row: 10,
    };
    for (const f of SHEET_FEATURES) if (rnd(chance[f]) === 0) on.add(f);
    if (on.has("group_labels")) on.delete("two_row_header");
  }
  const m: MatrixCell[][] = [];
  if (on.has("leading_blank_rows")) m.push([], []);
  const tables = [table(rnd, m, on, !on.has("second_table"))];
  if (on.has("second_table")) {
    m.push([]);
    const second = new Set<Feature>(["title", ...(on.has("footer") ? (["footer"] as Feature[]) : [])]);
    if (rnd(2) === 0) second.delete("title");
    tables.push(table(rnd, m, second, true));
  }
  return { matrix: m, tables, features: [...on] };
}

const view = (b: ReadBlock) => ({ title: b.title, headers: b.headers, rows: b.rows });
const viewTruth = (t: Truth) => ({ title: t.title, headers: t.headers, rows: t.rows });

describe("sheet reader property: sure means right, hints mean right", () => {
  test("generated sheets, each feature alone and in real-looking mixes", () => {
    const cases: Case[] = [];
    let seed = 1;
    for (const f of SHEET_FEATURES) for (let k = 0; k < 60; k++) cases.push(generateSheet(seed++, [f]));
    for (let k = 0; k < 300; k++) cases.push(generateSheet(seed++, [SHEET_FEATURES[k % 13]!, SHEET_FEATURES[(k * 5 + 3) % 13]!]));
    for (let k = 0; k < 2000; k++) cases.push(generateSheet(seed++));
    let sure = 0;
    for (const c of cases) {
      const label = `${c.features.join(",")} ${JSON.stringify(c.matrix).slice(0, 300)}`;
      const guessed = readSheet(c.matrix);
      guessed.blocks.forEach((b, i) => {
        if (b.confidence !== "sure") return;
        sure++;
        expect(guessed.blocks.length, label).toBe(c.tables.length);
        expect(view(b), label).toEqual(viewTruth(c.tables[i]!));
      });
      // No row disappears: every filled raw row is in a block's region or in the warnings.
      const covered = new Set<number>(guessed.warnings.map((w) => w.row));
      for (const b of guessed.blocks) for (let r = b.preview[0]!.row; r <= Math.max(b.guess.lastDataRow ?? 0, b.guess.headerRow + b.headerRows - 1); r++) covered.add(r);
      c.matrix.forEach((r, i) => {
        if (r.some((x) => toCellText(x) !== "")) expect(covered.has(i), `${label}: row ${i}`).toBe(true);
      });
      // The guess given back as hints reads the same blocks.
      if (guessed.blocks.length > 0) {
        const again = readSheet(c.matrix, { hints: guessed.blocks.map((b) => b.guess) });
        expect(again.blocks.map(view), label).toEqual(guessed.blocks.map(view));
      }
      const hinted = readSheet(c.matrix, { hints: c.tables.map((t) => t.hints) });
      expect(hinted.blocks.map(view), label).toEqual(c.tables.map(viewTruth));
    }
    expect(sure).toBeGreaterThan(300);
  });
});
