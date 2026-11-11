/**
 * The acceptance property of PORTAL-RULES-3 section 5.5, over a seeded generator of its own: key and value letterheads,
 * long letterheads, Indian-script headers and titles, units rows (approved as two-row layouts or skipped by a hint),
 * unnamed edge columns, stacked tables, centred, left and right PDF headers over left and right values, and close PDF
 * cells.
 *
 * 1. `chooseHeader` never returns "fits" for a row that is not a true header of an approved layout (or a row that
 *    carries exactly a true table's column names).
 * 2. With the right hints every sheet and CSV read is exact.
 * 3. With the right hints every PDF read is exact, or every wrong row carries a doubt.
 *
 * `R5_SEEDS` sets the number of files (default 300); `R5_REPORT=1` prints the counts.
 */
import { describe, expect, test } from "bun:test";

import { headerKey, normalizeHeaders } from "../fingerprint";
import { chooseHeader, type HeaderHoles } from "../header";
import { combineHeaders, readSheet, toCellText } from "./blocks";
import { readCsv } from "./csv";
import { readPdfText, type TextItem } from "./pdf-text";
import { doubtedRows, layoutOf, pdfMismatch } from "./trust-helpers";
import type { BlockHints, ReadBlock } from "./types";

type Rand = () => number;
function rng(seed: number): Rand {
  let a = (seed * 2246822519) >>> 0;
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

type Kind = "party" | "code" | "int" | "dec" | "phone" | "city";
const NUMERIC = (k: Kind) => k === "int" || k === "dec";
const LAYOUTS: { head: string[]; kinds: Kind[] }[] = [
  { head: ["Name", "Phone", "City"], kinds: ["party", "phone", "city"] },
  { head: ["Party", "Section", "Pcs", "Kg"], kinds: ["party", "code", "int", "dec"] },
  { head: ["Series", "Section code", "Min weight", "Max weight"], kinds: ["int", "int", "dec", "dec"] },
  { head: ["Item", "Opening", "Received", "Issued"], kinds: ["code", "int", "int", "int"] },
  { head: ["Party", "Order No", "Section", "Cut Length", "Pcs", "Rate"], kinds: ["party", "int", "code", "int", "int", "dec"] },
  { head: ["नाम", "शहर", "फोन"], kinds: ["party", "city", "phone"] },
  { head: ["પાર્ટી", "સેક્શન", "નંગ", "કિલો"], kinds: ["party", "code", "int", "dec"] },
  { head: ["पार्टी का नाम", "सेक्शन", "वज़न"], kinds: ["party", "code", "dec"] },
];
const PARTY = ["Om Metals", "Kamal Bros", "Shree Ganesh", "Zenith Traders", "ઓમ મેટલ્સ", "राम ट्रेडर्स"];
const CITY = ["Rajkot", "Morbi", "Surat", "રાજકોટ", "जामनगर"];
const SEC = ["T4012", "R2105", "K1100", "F3301"];

function value(r: Rand, k: Kind): string {
  if (k === "party") return pick(r, PARTY);
  if (k === "code") return pick(r, SEC);
  if (k === "int") return String(int(r, 1, 900));
  if (k === "dec") return (r() * 50 + 0.5).toFixed(2);
  if (k === "phone") return `98${int(r, 10000000, 99999999)}`;
  return pick(r, CITY);
}

/** A generated table: header names ("" for an unnamed column), an optional units row, data rows. */
type Table = { head: string[]; kinds: Kind[]; units: string[] | null; approvedTwoRow: boolean; data: string[][] };
/** A generated file: rows above the first table, tables with the blank rows before each, and the features. */
type Gen = { above: string[][]; tables: Table[]; gaps: number[]; feats: string[]; pdfAlign: ("l" | "r" | "c")[]; close: boolean };

function genTable(r: Rand, feats: string[]): Table {
  const L = pick(r, LAYOUTS);
  let head = [...L.head];
  let kinds = [...L.kinds];
  if (/[^\x00-\x7f]/.test(head.join(""))) feats.push("indian_header");
  const edge = r() < 0.15 ? pick(r, ["lead", "trail"] as const) : null;
  if (edge === "lead") {
    head = ["", ...head];
    kinds = ["int", ...kinds];
    feats.push("unnamed_lead");
  }
  if (edge === "trail") {
    head = [...head, ""];
    kinds = [...kinds, "city"];
    feats.push("unnamed_trail");
  }
  const units = r() < 0.15 ? head.map((h, i) => (i === 0 || h === "" ? "" : NUMERIC(kinds[i]!) ? pick(r, ["kg", "pcs", "Rs", "mm"]) : "")) : null;
  const unitsOk = units !== null && units.some((u) => u !== "");
  if (unitsOk) feats.push("units");
  const n = int(r, 2, 6);
  const data: string[][] = [];
  for (let k = 0; k < n; k++) {
    data.push(kinds.map((kind, i) => (i === 0 && edge === "lead" ? String(k + 1) : edge === "trail" && i === kinds.length - 1 ? (r() < 0.5 ? pick(r, ["urgent", "ok", "hold"]) : "") : value(r, kind))));
  }
  return { head, kinds, units: unitsOk ? units : null, approvedTwoRow: unitsOk && r() < 0.5, data };
}

function generate(seed: number): Gen {
  const r = rng(seed);
  const feats: string[] = [];
  const above: string[][] = [];
  const pre = pick(r, ["none", "none", "title", "indian_title", "keyValue", "keyValue", "longLetterhead"]);
  if (pre === "title") above.push([pick(r, ["Stock statement", "Customer list"])]);
  if (pre === "indian_title") above.push([pick(r, ["શ્રી ગણેશ ટ્રેડર્સ", "ग्राहक सूची", "સ્ટોક પત્રક"])]);
  if (pre === "keyValue") above.push(["Party:", pick(r, PARTY), "City:", pick(r, CITY)], ["Phone", `98${int(r, 10000000, 99999999)}`]);
  if (pre === "longLetterhead") {
    const keys = ["Phone", "Email", "GSTIN", "Bank", "IFSC", "Account", "Period", "Prepared", "Checked", "Approved", "Ref", "Copy", "Plant"];
    for (const k of keys.slice(0, int(r, 12, 13))) above.push([k, pick(r, ["Office", "Rajkot", "24ABCDE1234F1Z5", "SBI"])]);
  }
  if (pre !== "none") feats.push(pre);
  const tables = [genTable(r, feats)];
  const gaps = [0];
  const second = pick(r, ["none", "none", "none", "stacked0", "stacked1", "stacked2"]);
  if (second !== "none") {
    tables.push(genTable(r, feats));
    gaps.push(second === "stacked0" ? 0 : second === "stacked1" ? 1 : 2);
    feats.push(second);
  }
  const pdfAlign = tables[0]!.head.map(() => pick(r, ["l", "r", "c"] as const));
  feats.push(`pdf_head_${pdfAlign.join("")}`.slice(0, 10));
  const close = r() < 0.2;
  if (close) feats.push("close_cells");
  return { above, tables, gaps, feats, pdfAlign, close };
}

type Truth = { hint: BlockHints; headers: string[]; rows: string[][]; key: string; headerRows: 1 | 2 };

/** The sheet of a file, the hints that read each table exactly, and the approved layouts of the plant. */
function toSheet(g: Gen): { matrix: string[][]; truths: Truth[]; learned: HeaderHoles } {
  const matrix: string[][] = g.above.map((r) => [...r]);
  const truths: Truth[] = [];
  g.tables.forEach((t, k) => {
    for (let b = 0; b < (k === 0 ? (g.above.length > 0 ? 1 : 0) : g.gaps[k]!); b++) matrix.push([]);
    const h = matrix.length;
    matrix.push([...t.head]);
    let headerRows: 1 | 2 = 1;
    let first = h + 1;
    let headers = [...t.head];
    if (t.units) {
      matrix.push([...t.units]);
      if (t.approvedTwoRow) {
        headerRows = 2;
        headers = combineHeaders(t.head, t.units);
      }
      first = h + 2;
    }
    for (const row of t.data) matrix.push([...row]);
    const last = matrix.length - 1;
    // The rows as a reader shapes them: trailing columns with no name and no value are cut.
    let width = headers.length;
    while (width > 0 && headers[width - 1] === "" && t.data.every((row) => (row[width - 1] ?? "") === "")) width--;
    truths.push({
      hint: { headerRow: h, headerRows, firstDataRow: first, lastDataRow: last },
      headers: headers.slice(0, width),
      rows: t.data.map((row) => row.slice(0, width).map((c) => toCellText(c))),
      key: headerKey(normalizeHeaders(headers.slice(0, width))),
      headerRows,
    });
  });
  const learned = { learned: truths.map((t, k) => layoutOf(t.headers, `t${k}`, t.headerRows)) };
  return { matrix, truths, learned };
}

const csvCell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
const toCsv = (m: string[][]) => m.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

const CW = 5;
const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * CW, height: 10 });

/**
 * The PDF page of a file: one line per filled row. Column `c` spans [x, x + w]: a header cell sits left, right or
 * centred in it; text values sit left, numbers right. With `close`, one gap between two columns is under two
 * characters wide. Hints are the sheet's, in page lines.
 */
function toPdf(g: Gen, matrix: string[][], truths: Truth[]): { items: TextItem[]; truths: Truth[] } {
  const lineOf: number[] = [];
  let n = 0;
  for (const row of matrix) lineOf.push(row.some((c) => c !== "") ? n++ : -1);
  const items: TextItem[] = [];
  let y = 800;
  // Columns of the first table set the x positions; a second table uses its own widths from the same start.
  const layout = (t: Table) => {
    const xs: [number, number][] = [];
    let x = 40;
    t.head.forEach((h, i) => {
      const w = Math.max(h.length, ...t.data.map((d) => (d[i] ?? "").length), t.units ? (t.units[i] ?? "").length : 0, 3) * CW;
      xs.push([x, x + w]);
      const gap = g.close && i === 1 ? 8 : 25 + (i % 3) * 10;
      x += w + gap;
    });
    return xs;
  };
  const placeIn = (s: string, [a, z]: [number, number], al: "l" | "r" | "c") => (al === "l" ? a : al === "r" ? z - s.length * CW : a + (z - a - s.length * CW) / 2);
  let tableAt = -1;
  let cols: [number, number][] = [];
  let tbl: Table | null = null;
  let headAt = -1;
  matrix.forEach((row, ri) => {
    const t = g.tables.findIndex((_, k) => truths[k]!.hint.headerRow === ri);
    if (t !== -1) {
      tableAt = t;
      tbl = g.tables[t]!;
      cols = layout(tbl);
      headAt = ri;
    }
    if (lineOf[ri] === -1) return;
    if (tableAt === -1 || !tbl) {
      // Rows above the first table: cells left to right at a fixed pitch.
      row.forEach((c, i) => c !== "" && items.push(item(c, 40 + i * 150, y)));
    } else {
      const isHead = ri === headAt || (tbl.units !== null && ri === headAt + 1);
      row.forEach((c, i) => {
        if (c === "" || !cols[i]) return;
        const al = isHead ? (tableAt === 0 ? g.pdfAlign[i]! : "l") : NUMERIC(tbl!.kinds[i]!) ? "r" : "l";
        items.push(item(c, placeIn(c, cols[i]!, al), y));
      });
    }
    y -= 15;
  });
  const pdfTruths = truths.map((t) => ({
    ...t,
    hint: { page: 1, headerRow: lineOf[t.hint.headerRow]!, headerRows: t.hint.headerRows, firstDataRow: lineOf[t.hint.firstDataRow!]!, lastDataRow: lineOf[t.hint.lastDataRow!]! },
  }));
  return { items, truths: pdfTruths };
}

/** A "fits" at a row that is not a true header, or null. */
function wrongFit(b: ReadBlock, truths: readonly Truth[], holes: HeaderHoles): string | null {
  const c = chooseHeader(b, holes);
  if (c.kind !== "fits") return null;
  const at = truths.some((t) => (t.hint.page ?? 1) === (b.guess.page ?? 1) && t.hint.headerRow === c.headerRow && (t.hint.headerRows ?? 1) === c.headerRows);
  if (at) return null;
  if (c.fit.learned && truths.some((t) => t.key === c.fit.recipe.match.headerKey)) return null;
  return `fits ${c.headerRow}x${c.headerRows} ${c.fit.name}`;
}

const view = (b: ReadBlock) => ({ headers: b.headers, rows: b.rows });
/** The blocks read by the hints; rows outside every hinted table are still guessed (R3-7). */
const hinted = (bs: readonly ReadBlock[]) => bs.filter((b) => b.hints !== null);

describe("round 5 acceptance property", () => {
  test("no wrong fit; hinted sheet and CSV reads exact; every wrong PDF cell on a marked row", () => {
    const seeds = Number(process.env.R5_SEEDS ?? 300);
    const counts = { files: 0, wrongFits: 0, inexactSheet: 0, inexactCsv: 0, pdfUnmarked: 0, fits: 0, cleanRows: 0, cleanDoubted: 0 };
    const feats = new Map<string, number>();
    for (let seed = 1; seed <= seeds; seed++) {
      const g = generate(seed);
      for (const f of g.feats) feats.set(f, (feats.get(f) ?? 0) + 1);
      const label = `seed ${seed} ${g.feats.join(",")}`;
      const { matrix, truths, learned } = toSheet(g);
      counts.files++;

      const hints = truths.map((t) => t.hint);
      const sheet = readSheet(matrix, { hints });
      if (!Bun.deepEquals(hinted(sheet.blocks).map(view), truths.map((t) => ({ headers: t.headers, rows: t.rows })))) {
        counts.inexactSheet++;
        expect(hinted(sheet.blocks).map(view), `${label} sheet`).toEqual(truths.map((t) => ({ headers: t.headers, rows: t.rows })));
      }
      const csv = readCsv(toCsv(matrix), { hints });
      if (!Bun.deepEquals(hinted(csv.blocks).map(view), truths.map((t) => ({ headers: t.headers, rows: t.rows })))) {
        counts.inexactCsv++;
        expect(hinted(csv.blocks).map(view), `${label} csv`).toEqual(truths.map((t) => ({ headers: t.headers, rows: t.rows })));
      }
      for (const b of [...readSheet(matrix).blocks, ...readCsv(toCsv(matrix)).blocks]) {
        for (const holes of [{}, learned]) {
          const w = wrongFit(b, truths, holes);
          if (w) counts.wrongFits++;
          expect(w, `${label} sheet guess`).toBeNull();
        }
        if (chooseHeader(b, learned).kind === "fits") counts.fits++;
      }

      const pdf = toPdf(g, matrix, truths);
      const read = readPdfText([pdf.items], { hints: pdf.truths.map((t) => t.hint) });
      const pdfBlocks = hinted(read.blocks);
      expect(pdfBlocks.length, label).toBe(pdf.truths.length);
      pdfBlocks.forEach((b, k) => {
        const m = pdfMismatch(b, pdf.truths[k]!);
        if (m) counts.pdfUnmarked++;
        expect(m, `${label} pdf ${JSON.stringify(pdf.truths[k]!.hint)}`).toBeNull();
        const t = g.tables[k]!;
        const clean = !g.close && !t.head.includes("");
        if (clean) {
          counts.cleanRows += b.rows.length;
          counts.cleanDoubted += doubtedRows(b);
        }
      });
      const pdfLearned: HeaderHoles = { learned: pdf.truths.map((t, k) => layoutOf(t.headers, `t${k}`, t.headerRows)) };
      for (const b of readPdfText([pdf.items]).blocks) {
        for (const holes of [{}, pdfLearned]) {
          const w = wrongFit(b, pdf.truths, holes);
          if (w) counts.wrongFits++;
          expect(w, `${label} pdf guess`).toBeNull();
        }
      }
    }
    if (process.env.R5_REPORT) console.log(JSON.stringify({ ...counts, cleanDoubtedShare: counts.cleanRows ? counts.cleanDoubted / counts.cleanRows : 0, feats: Object.fromEntries(feats) }));
    for (const f of ["keyValue", "longLetterhead", "indian_header", "indian_title", "units", "unnamed_lead", "unnamed_trail", "stacked0", "stacked1", "stacked2", "close_cells"]) {
      expect(feats.get(f) ?? 0, f).toBeGreaterThan(seeds / 60);
    }
    expect(counts.fits).toBeGreaterThan(seeds / 3);
  }, 600_000);
});
