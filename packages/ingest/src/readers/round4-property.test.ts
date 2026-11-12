/**
 * The acceptance property of PORTAL-RULES-3 section 4.1 (replaces "sure means right"), over a seeded generator of its
 * own that also covers the layouts of the round 4 checker's generator: letterheads of two cells, as wide as the table
 * and wider; titles, colon lines and key and value lines; column-number and unit rows; text, number, date, year,
 * decimal, falling and section-number headers; two-row headers; words in number columns; wrapped cells; totals, place
 * and date footers, signatures and two-cell footers; a second table stacked with no gap, after one blank row or far
 * down; tables side by side; leading blank rows; right-aligned PDF values under short left-aligned names.
 *
 * 1. With the right hints every reader (sheet, CSV, PDF text) returns exactly the generated tables.
 * 2. `chooseHeader` never returns "fits" for a row that is not a true header, with the built-in layouts or with the
 *    plant knowing the generated layouts, unless that row carries exactly a true table's column names.
 */
import { describe, expect, test } from "bun:test";

import { chooseHeader, type HeaderHoles } from "../header";
import { combineHeaders, finishShape, readSheet, toCellText } from "./blocks";
import { readCsv } from "./csv";
import { readPdfText, type TextItem } from "./pdf-text";
import { layoutOf, pdfMismatch } from "./trust-helpers";
import type { BlockHints, MatrixCell, ReadBlock } from "./types";

type Rand = () => number;
function rng(seed: number): Rand {
  let a = (seed * 2654435761) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const D = (m: number, d: number) => new Date(Date.UTC(2025, m - 1, d));

type Kind = "party" | "code" | "int" | "dec" | "phone" | "city" | "date" | "id";
type Layout = { head: MatrixCell[]; kinds: Kind[] };
const PARTY = ["Om Metals", "Kamal Bros", "Shree Ganesh", "Zenith Traders", "Patel Steel"];
const SEC = ["T 4012", "R 2105", "K 1100", "F 3301"];
const LAYOUTS: (() => Layout)[] = [
  () => ({ head: ["Name", "Phone", "City"], kinds: ["party", "phone", "city"] }),
  () => ({ head: ["Series", "Section code", "Min weight (kg/12ft)", "Max weight (kg/12ft)"], kinds: ["int", "int", "dec", "dec"] }),
  () => ({ head: ["Legacy id", "Die series", "Section code", "Pcs", "Weight (kg)", "Length (mm)"], kinds: ["id", "int", "int", "int", "dec", "int"] }),
  () => ({ head: ["Party", "Section", "Pcs", "Kg"], kinds: ["party", "code", "int", "int"] }),
  () => ({ head: ["Item", "Opening", "Received", "Issued"], kinds: ["code", "int", "int", "int"] }),
  () => ({ head: ["Profile", 12, 14, 16], kinds: ["code", "int", "int", "int"] }),
  () => ({ head: ["Profile", 20, 16, 12], kinds: ["code", "int", "int", "int"] }),
  () => ({ head: ["Particulars", D(4, 15), D(4, 16)], kinds: ["party", "int", "int"] }),
  () => ({ head: ["Particulars", "15-04-2025", "16-04-2025", "17-04-2025"], kinds: ["party", "int", "int", "int"] }),
  () => ({ head: ["Buyer", 3.6, 4.2, 5], kinds: ["party", "int", "int", "int"] }),
  () => ({ head: ["Buyer", 4012, 2105], kinds: ["party", "int", "int"] }),
  () => ({ head: ["Party", 2024, 2025], kinds: ["party", "int", "int"] }),
  () => ({ head: ["Profile", "12 ft", "14 ft"], kinds: ["code", "int", "int"] }),
];

function value(r: Rand, k: Kind): MatrixCell {
  if (k === "party") return pick(r, PARTY);
  if (k === "code") return pick(r, SEC);
  if (k === "int") return int(r, 1, 900);
  if (k === "dec") return Number((r() * 5 + 0.5).toFixed(2));
  if (k === "phone") return `98${int(r, 10000000, 99999999)}`;
  if (k === "city") return pick(r, ["Rajkot", "Morbi", "Surat"]);
  if (k === "id") return int(r, 10000, 99999);
  return D(int(r, 1, 12), int(r, 1, 28));
}

/** One generated table: its raw rows (header, optional second header row, optional skipped row, data, footers). */
type GenTable = { header: MatrixCell[][]; skipped: MatrixCell[] | null; data: MatrixCell[][]; feats: string[] };

function genTable(r: Rand, wrapOk: boolean): GenTable {
  const L = pick(r, LAYOUTS)();
  const w = L.head.length;
  const feats: string[] = [];
  let header: MatrixCell[][] = [L.head];
  if (w >= 3 && r() < 0.15) {
    const top = L.head.map((h, i) => (i < w - 2 ? h : ""));
    top[w - 2] = pick(r, ["Apr 2025", "Weight", "Stock"]);
    header = [top, L.head.map((h, i) => (i < w - 2 ? "" : h))];
    feats.push("two_row");
  }
  const post = pick(r, ["none", "none", "none", "none", "colnums", "units"]);
  const skipped = post === "colnums" ? L.head.map((_, i) => i + 1) : post === "units" ? ["", ...L.head.slice(1).map(() => pick(r, ["kg", "pcs", "Rs"]))] : null;
  if (skipped) feats.push(post);
  const n = int(r, 2, 7);
  const data: MatrixCell[][] = [];
  for (let k = 0; k < n; k++) data.push(L.kinds.map((kind) => value(r, kind)));
  if (wrapOk && r() < 0.15) {
    const c = L.kinds.indexOf("party");
    if (c !== -1) {
      data[int(r, 0, n - 1)]![c] = "Shree Ganesh\nTraders";
      feats.push("wrapped");
    }
  }
  if (r() < 0.12) {
    const c = L.kinds.lastIndexOf("int");
    if (c > 0) {
      data[int(r, 0, n - 1)]![c] = pick(r, ["Nil", "Pending", "Cancelled", "-"]);
      feats.push("word");
    }
  }
  const foot = pick(r, ["none", "none", "none", "total", "adj2", "placeDate", "sign1"]);
  if (foot === "total") data.push(["Total", ...L.head.slice(1).map((_, i) => (L.kinds[i + 1] === "int" ? int(r, 100, 9000) : ""))]);
  if (foot === "adj2") data.push(["Prepared by", "Checked by"]);
  if (foot === "placeDate") data.push(L.head.map((_, i) => (i === 0 ? "Rajkot" : i === w - 1 ? "11-11-2025" : "")));
  if (foot === "sign1") data.push(["Authorised Signatory"]);
  if (foot !== "none") feats.push(foot);
  return { header, skipped, data, feats };
}

/** A generated file: tables in order, the rows above the first one, and how the tables are spaced. */
type Gen = { lead: number; above: MatrixCell[][]; tables: GenTable[]; gaps: number[]; side: GenTable | null; feats: string[] };

function generate(seed: number): Gen {
  const r = rng(seed);
  const feats: string[] = [];
  const first = genTable(r, true);
  const w = first.header[0]!.length;
  const LH = ["Fourcubes Extrusions", "Rajkot", "Gujarat", "India", "GSTIN 24AB", "Ph 0281", "Stock"];
  const pre = pick(r, ["none", "none", "title", "lh2", "lhW", "lhW", "lhWider", "colon", "keyValue"]);
  const above: MatrixCell[][] = [];
  if (pre === "title") above.push([pick(r, ["Stock statement", "Customer list", "Despatch Register 2025-26"])]);
  if (pre === "lh2") above.push(LH.slice(0, 2));
  if (pre === "lhW") above.push(LH.slice(0, w));
  if (pre === "lhWider") above.push(LH.slice(0, w + 1));
  if (pre === "colon") above.push(["Party: Om Metals", "Date: 11-11-2025"]);
  if (pre === "keyValue") above.push(["Name", "Om Metals"], ["Phone", "9825012345"]);
  if (pre !== "none") feats.push(pre);
  const lead = pick(r, [0, 0, 0, 1, 3]);
  if (lead) feats.push("lead");
  const tables = [first];
  const gaps: number[] = [];
  const second = pick(r, ["none", "none", "none", "stacked", "blank1", "far"]);
  if (second !== "none") {
    tables.push(genTable(r, true));
    gaps.push(second === "stacked" ? 0 : second === "blank1" ? 1 : 30);
    feats.push(second);
  }
  const side = second === "none" && r() < 0.08 ? genTable(r, false) : null;
  if (side) feats.push("side");
  return { lead, above, tables, gaps, side, feats: [...feats, ...tables.flatMap((t) => t.feats)] };
}

type Truth = { hint: BlockHints; headers: string[]; rows: string[][] };

/** The sheet of a generated file and the true blocks with their hints. Side by side: one wide table, as a hint reads it. */
function toSheet(g: Gen): { matrix: MatrixCell[][]; truths: Truth[] } {
  const matrix: MatrixCell[][] = [];
  for (let i = 0; i < g.lead; i++) matrix.push([]);
  matrix.push(...g.above);
  const truths: Truth[] = [];
  g.tables.forEach((t0, ti) => {
    if (ti > 0) for (let i = 0; i < g.gaps[ti - 1]!; i++) matrix.push([]);
    const t = ti === 0 && g.side ? sideBySide(t0, g.side) : t0;
    const headerRow = matrix.length;
    matrix.push(...t.header);
    if (t.skipped) matrix.push(t.skipped);
    const firstDataRow = matrix.length;
    matrix.push(...t.data);
    const text = (row: MatrixCell[]) => row.map(toCellText);
    const names = t.header.length === 2 ? combineHeaders(text(t.header[0]!), text(t.header[1]!)) : text(t.header[0]!);
    const shaped = finishShape(names, t.data.map(text));
    truths.push({ hint: { headerRow, headerRows: t.header.length as 1 | 2, firstDataRow, lastDataRow: matrix.length - 1 }, headers: shaped.headers, rows: shaped.rows });
  });
  return { matrix, truths };
}

function sideBySide(a: GenTable, b: GenTable): GenTable {
  const wa = a.header[a.header.length - 1]!.length;
  const pad = (row: MatrixCell[] | undefined, w: number) => Array.from({ length: w }, (_, i) => row?.[i] ?? "");
  const rows = Math.max(a.data.length, b.data.length);
  return {
    header: [[...pad(a.header[0], wa), "", ...b.header[0]!]],
    skipped: null,
    data: Array.from({ length: rows }, (_, k) => [...pad(a.data[k], wa), "", ...pad(b.data[k], b.header[0]!.length)]),
    feats: [],
  };
}

/** CSV text of a sheet, every cell as its text, quoted when it holds a comma, a quote or a line break. */
function toCsv(matrix: MatrixCell[][]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return matrix.map((r) => r.map((c) => q(toCellText(c))).join(",")).join("\n") + "\n";
}

/** A PDF page of the same file: one line per row, a wrapped cell as a second line close under it. */
function toPdf(g: Gen, seed: number): { pages: TextItem[][]; truths: Truth[] } {
  const r = rng(seed * 31 + 7);
  const right = r() < 0.5;
  const items: TextItem[] = [];
  let y = 800;
  let line = 0;
  const PITCH = 15;
  const X = (c: number) => 50 + 140 * c;
  const put = (s: string, x: number) => items.push({ str: s, x, y, width: s.length * 5, height: 10 });
  /** One row: returns the number of page lines it took. */
  const emit = (row: MatrixCell[], header: boolean): number => {
    let wrapped: { text: string; x: number } | null = null;
    row.forEach((cell, c) => {
      const s = toCellText(cell);
      if (s === "") return;
      const [first, rest] = s.split("\n");
      const k = typeof cell === "number" ? "num" : "text";
      const x = !header && right && k === "num" ? X(c) + 60 - first!.length * 5 : X(c);
      put(first!, x);
      if (rest) wrapped = { text: rest, x };
    });
    let used = 1;
    if (wrapped) {
      const w = wrapped as { text: string; x: number };
      y -= 7;
      put(w.text, w.x);
      used++;
      y -= PITCH - 7;
    } else y -= PITCH;
    line += used;
    return used;
  };
  for (const row of g.above) emit(row, true);
  const truths: Truth[] = [];
  g.tables.forEach((t0, ti) => {
    if (ti > 0) y -= PITCH * Math.min(g.gaps[ti - 1]!, 20) * 2;
    const t = ti === 0 && g.side ? sideBySide(t0, g.side) : t0;
    const headerRow = line;
    for (const h of t.header) emit(h, true);
    if (t.skipped) emit(t.skipped, true);
    const firstDataRow = line;
    for (const d of t.data) emit(d, false);
    const text = (row: MatrixCell[]) => row.map((c) => toCellText(c).replace(/\n/g, " "));
    const names = t.header.length === 2 ? combineHeaders(text(t.header[0]!), text(t.header[1]!)) : text(t.header[0]!);
    // A column with no header cell and no cell in any row is nothing on a page.
    const keep = names.map((n, c) => n !== "" || t.data.some((d) => toCellText(d[c] ?? "") !== ""));
    const cut = (row: string[]) => row.filter((_, c) => keep[c]);
    const shaped = finishShape(cut(names), t.data.map((d) => cut(text(d))));
    // A PDF row has a cell for every column.
    shaped.rows = shaped.rows.map((row) => Array.from({ length: shaped.headers.length }, (_, c) => row[c] ?? ""));
    truths.push({ hint: { page: 1, headerRow, headerRows: t.header.length as 1 | 2, firstDataRow, lastDataRow: line - 1 }, headers: shaped.headers, rows: shaped.rows });
  });
  return { pages: [items], truths };
}

const view = (b: ReadBlock) => ({ headers: b.headers, rows: b.rows });
const viewTruth = (t: Truth) => ({ headers: t.headers, rows: t.rows });

/** A fit at a row that is not a true header, with these layouts: the failure the rule forbids. */
function wrongFit(b: ReadBlock, truths: Truth[], holes: HeaderHoles): string | null {
  const c = chooseHeader(b, holes);
  if (c.kind !== "fits") return null;
  const at = truths.some((t) => t.hint.headerRow === c.headerRow && (t.hint.headerRows ?? 1) === c.headerRows && (t.hint.page ?? 1) === (b.guess.page ?? 1));
  if (at) return null;
  // The row carries exactly a true table's column names (a header repeated, a second table of the same layout).
  if (c.fit.learned && c.fit.fit === "exact") return null;
  return `fits row ${c.headerRow}/${c.headerRows} as ${c.fit.name} (${c.fit.fit})`;
}

/** Generated files per run. A scratch run over 1,200 seeds (sheet, CSV and PDF each) gave no miss and no wrong fit. */
const SEEDS = 800;

describe("round 4 acceptance property", () => {
  test("with the right hints every reader returns exactly the generated tables; chooseHeader never fits a wrong row", () => {
    let fits = 0;
    const feats = new Map<string, number>();
    for (let seed = 1; seed <= SEEDS; seed++) {
      const g = generate(seed);
      for (const f of g.feats) feats.set(f, (feats.get(f) ?? 0) + 1);
      const label = `seed ${seed} ${g.feats.join(",")}`;
      const { matrix, truths } = toSheet(g);
      const learned: HeaderHoles = { learned: truths.map((t, k) => layoutOf(t.headers, `t${k}`)) };

      const sheet = readSheet(matrix, { hints: truths.map((t) => t.hint) });
      expect(sheet.blocks.map(view), `${label} sheet`).toEqual(truths.map(viewTruth));
      const csv = readCsv(toCsv(matrix), { hints: truths.map((t) => t.hint) });
      expect(csv.blocks.map(view), `${label} csv`).toEqual(truths.map(viewTruth));

      for (const b of [...readSheet(matrix).blocks, ...readCsv(toCsv(matrix)).blocks]) {
        expect(wrongFit(b, truths, {}), `${label} sheet guess`).toBeNull();
        expect(wrongFit(b, truths, learned), `${label} sheet guess, known layouts`).toBeNull();
        if (chooseHeader(b, learned).kind === "fits") fits++;
      }

      const pdf = toPdf(g, seed);
      const read = readPdfText(pdf.pages, { hints: pdf.truths.map((t) => t.hint) });
      // Rule 5.5: exact, or every wrong row carries a doubt (round 5; was strict equality, see sure-property-pdf).
      expect(read.blocks.length, label).toBe(pdf.truths.length);
      read.blocks.forEach((b, k) => expect(pdfMismatch(b, pdf.truths[k]!), `${label} pdf ${JSON.stringify(pdf.truths.map((t) => t.hint))}`).toBeNull());
      const pdfLearned: HeaderHoles = { learned: pdf.truths.map((t, k) => layoutOf(t.headers, `t${k}`)) };
      for (const b of readPdfText(pdf.pages).blocks) {
        expect(wrongFit(b, pdf.truths, {}), `${label} pdf guess`).toBeNull();
        expect(wrongFit(b, pdf.truths, pdfLearned), `${label} pdf guess, known layouts`).toBeNull();
      }
    }
    // The generator really covers the layouts, and known layouts are found.
    for (const f of ["lhW", "lhWider", "colnums", "units", "stacked", "blank1", "far", "side", "wrapped", "placeDate", "two_row", "keyValue"]) {
      expect(feats.get(f) ?? 0, f).toBeGreaterThan(20);
    }
    expect(fits).toBeGreaterThan(400);
  }, 300_000);
});
