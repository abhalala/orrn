/**
 * The round 6 acceptance property, sheets and CSV only (the first release reads no PDF). A seeded generator of its own
 * adds to round 5's cases: layouts of unit words, names that differ by a sign or a count word (with the sibling
 * layout approved as a decoy), runs of blank rows inside a table read with hints that give no last row, an unnamed
 * column filled only below the preview, Date cells, and remarks that hold a semicolon or a pipe.
 *
 * 1. Wrong fits 0: `chooseHeader` never returns "fits" for a row that is not a true header, never through a layout that
 *    is not the true table's (a decoy), and never through a layout with fewer than two named columns or no real name
 *    (rule 6.3, round 7).
 * 2. Inexact hinted reads 0: with the right hints, every sheet and CSV read is exact, dates as the date written. With
 *    no last row a hinted block ends at the first blank row (rule 6.1, round 7); the rows below are counted by 3.
 * 3. Cells lost 0: every filled cell of the file is in a header, a data row (the same text), or a listed row.
 * 4. A known layout with an unnamed column filled only below the preview fits the same file again.
 *
 * `R6_SEEDS` sets the number of files (default 300); `R6_REPORT=1` prints the counts.
 */
import { describe, expect, test } from "bun:test";

import { headerKey, isUnitOnlyName, normalizeHeaders } from "../fingerprint";
import { chooseHeader, type HeaderHoles } from "../header";
import { combineHeaders, readSheet, type SheetRead } from "./blocks";
import { readCsv } from "./csv";
import { layoutOf } from "./trust-helpers";
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

type Kind = "party" | "code" | "int" | "dec" | "phone" | "city" | "date" | "remark";
const NUMERIC = (k: Kind) => k === "int" || k === "dec";
type Layout = { head: string[]; kinds: Kind[]; decoy?: string[]; feat?: string };
const LAYOUTS: Layout[] = [
  { head: ["Name", "Phone", "City"], kinds: ["party", "phone", "city"] },
  { head: ["Party", "Section", "Pcs", "Kg"], kinds: ["party", "code", "int", "dec"], decoy: ["Party", "Section", "Nos", "Kg"], feat: "near_count" },
  { head: ["Series", "Section code", "Min weight", "Max weight"], kinds: ["int", "int", "dec", "dec"] },
  { head: ["Party", "Order No", "Section", "Cut Length", "Pcs", "Rate"], kinds: ["party", "int", "code", "int", "int", "dec"] },
  { head: ["Date", "Party", "Section", "Kg"], kinds: ["date", "party", "code", "dec"] },
  { head: ["नाम", "शहर", "फोन"], kinds: ["party", "city", "phone"] },
  { head: ["પાર્ટી", "સેક્શન", "નંગ", "કિલો"], kinds: ["party", "code", "int", "dec"] },
  // Names that differ only by a sign or a count word, with the sibling layout approved as a decoy.
  { head: ["Section", "Size", "Tol +", "Tol -"], kinds: ["code", "dec", "dec", "dec"], decoy: ["Section", "Size", "Tol -", "Tol +"], feat: "near_sign" },
  { head: ["Party", "Section", "Rate", "Rate %"], kinds: ["party", "code", "dec", "int"], decoy: ["Party", "Section", "Rate %", "Rate"], feat: "near_sign" },
  { head: ["Section", "Order #", "Nos", "Kg"], kinds: ["code", "int", "int", "dec"], decoy: ["Section", "Order", "Pcs", "Kg"], feat: "near_count" },
  // Layouts of unit words: approved, they must never be trusted.
  { head: ["", "Kg", "Pcs"], kinds: ["party", "dec", "int"], feat: "unit_layout" },
  { head: ["Party", "Kg"], kinds: ["party", "dec"], feat: "unit_layout" },
  { head: ["Section", "Kg/12ft", "Nos", "%"], kinds: ["code", "dec", "int", "int"], feat: "unit_layout" },
  // A remark with a semicolon or a pipe on every line.
  { head: ["Section", "Pcs", "Kg", "Remarks"], kinds: ["code", "int", "dec", "remark"], feat: "remark_sep" },
];
const PARTY = ["Om Metals", "Kamal Bros", "Shree Ganesh", "Zenith Traders", "ઓમ મેટલ્સ", "राम ट्रेडर्स"];
const CITY = ["Rajkot", "Morbi", "Surat", "રાજકોટ", "जामनगर"];
const SEC = ["T4012", "R2105", "K1100", "F3301"];
const two = (x: number) => String(x).padStart(2, "0");

/** A cell: what the file holds (`raw`, a Date for a date cell in a sheet) and the text a person saw (`text`). */
type Cell = { raw: MatrixCell; text: string };
function value(r: Rand, k: Kind, remarkSep: string): Cell {
  const t = (s: string): Cell => ({ raw: s, text: s });
  if (k === "party") return t(pick(r, PARTY));
  if (k === "code") return t(pick(r, SEC));
  if (k === "int") return t(String(int(r, 1, 900)));
  if (k === "dec") return t((r() * 50 + 0.5).toFixed(2));
  if (k === "phone") return t(`98${int(r, 10000000, 99999999)}`);
  if (k === "remark") return t(`${pick(r, ["ok", "hold", "recheck"])}${remarkSep} ${pick(r, ["done", "late", "fine"])}`);
  if (k === "date") {
    const y = int(r, 1998, 2031);
    const m = int(r, 1, 12);
    const d = int(r, 1, 28);
    // Half built at UTC midnight (libraries that build dates in UTC), half at local midnight (SheetJS).
    return { raw: r() < 0.5 ? new Date(Date.UTC(y, m - 1, d)) : new Date(y, m - 1, d), text: `${y}-${two(m)}-${two(d)}` };
  }
  return t(pick(r, CITY));
}

type Table = { head: string[]; kinds: Kind[]; units: string[] | null; approvedTwoRow: boolean; data: Cell[][]; decoy: string[] | null };
type Gen = { above: string[][]; tables: Table[]; gaps: number[]; feats: string[]; noLast: boolean };
const BLANK: Cell = { raw: "", text: "" };

function genTable(r: Rand, feats: string[], opts: { below?: boolean } = {}): Table {
  const L = opts.below ? pick(r, LAYOUTS.filter((l) => !l.feat && !l.head.includes(""))) : pick(r, LAYOUTS);
  if (L.feat) feats.push(L.feat);
  let head = [...L.head];
  let kinds = [...L.kinds];
  const remarkSep = pick(r, [";", "|"]);
  const n = opts.below ? int(r, 16, 24) : int(r, 2, 7);
  const data: Cell[][] = [];
  for (let k = 0; k < n; k++) data.push(kinds.map((kind) => value(r, kind, remarkSep)));
  if (opts.below) {
    // An unnamed column filled at one row only, below the preview.
    head = [...head, ""];
    kinds = [...kinds, "city"];
    const at = int(r, 14, n - 1);
    data.forEach((row, k) => row.push(k === at ? { raw: "urgent", text: "urgent" } : BLANK));
    feats.push("unnamed_below");
  }
  // Runs of blank rows inside the table.
  if (!opts.below && r() < 0.3 && data.length >= 3) {
    const at = int(r, 1, data.length - 1);
    const run = int(r, 1, 5);
    data.splice(at, 0, ...Array.from({ length: run }, () => head.map(() => BLANK)));
    feats.push(run >= 2 ? "blank_run" : "blank_one");
  }
  const units = !opts.below && !L.feat && r() < 0.2 ? head.map((h, i) => (i === 0 || h === "" ? "" : NUMERIC(kinds[i]!) ? pick(r, ["kg", "pcs", "nos", "Rs", "mm"]) : "")) : null;
  const unitsOk = units !== null && units.some((u) => u !== "");
  if (unitsOk) feats.push("units");
  if (kinds.includes("date")) feats.push("dates");
  return { head, kinds, units: unitsOk ? units : null, approvedTwoRow: unitsOk && r() < 0.5, data, decoy: L.decoy ?? null };
}

function generate(seed: number): Gen {
  const r = rng(seed);
  const feats: string[] = [];
  if (r() < 0.12) {
    // A file with one table whose unnamed column is filled only below the preview, and nothing above it.
    return { above: [], tables: [genTable(r, feats, { below: true })], gaps: [0], feats, noLast: r() < 0.5 };
  }
  const above: string[][] = [];
  const pre = pick(r, ["none", "none", "title", "indian_title", "keyValue", "longLetterhead"]);
  if (pre === "title") above.push([pick(r, ["Stock statement", "Customer list"])]);
  if (pre === "indian_title") above.push([pick(r, ["શ્રી ગણેશ ટ્રેડર્સ", "ग्राहक सूची"])]);
  if (pre === "keyValue") above.push(["Party:", pick(r, PARTY), "City:", pick(r, CITY)], ["Phone", `98${int(r, 10000000, 99999999)}`]);
  if (pre === "longLetterhead") for (const k of ["Phone", "Email", "GSTIN", "Bank", "IFSC", "Account", "Period", "Prepared", "Checked", "Approved", "Ref", "Copy", "Plant"]) above.push([k, pick(r, ["Office", "Rajkot", "SBI"])]);
  if (pre !== "none") feats.push(pre);
  const tables = [genTable(r, feats)];
  const gaps = [0];
  const second = pick(r, ["none", "none", "stacked0", "stacked1", "stacked3"]);
  if (second !== "none") {
    tables.push(genTable(r, feats));
    gaps.push(second === "stacked0" ? 0 : second === "stacked1" ? 1 : 3);
    feats.push(second);
  }
  const noLast = r() < 0.5;
  if (noLast) feats.push("no_last_row");
  return { above, tables, gaps, feats, noLast };
}

type Truth = { hint: BlockHints; headers: string[]; rows: string[][]; key: string; headerRows: 1 | 2 };

function toFile(g: Gen): { matrix: MatrixCell[][]; text: string[][]; truths: Truth[]; learned: HeaderHoles } {
  const matrix: MatrixCell[][] = g.above.map((r) => [...r]);
  const text: string[][] = g.above.map((r) => [...r]);
  const truths: Truth[] = [];
  const push = (raw: MatrixCell[], txt: string[]) => {
    matrix.push(raw);
    text.push(txt);
  };
  g.tables.forEach((t, k) => {
    for (let b = 0; b < (k === 0 ? (g.above.length > 0 ? 1 : 0) : g.gaps[k]!); b++) push([], []);
    const h = matrix.length;
    push([...t.head], [...t.head]);
    let headerRows: 1 | 2 = 1;
    let headers = [...t.head];
    if (t.units) {
      push([...t.units], [...t.units]);
      if (t.approvedTwoRow) {
        headerRows = 2;
        headers = combineHeaders(t.head, t.units);
      }
    }
    const first = h + (t.units ? 2 : 1);
    for (const row of t.data) push(row.every((c) => c.text === "") ? [] : row.map((c) => c.raw), row.every((c) => c.text === "") ? [] : row.map((c) => c.text));
    const last = matrix.length - 1;
    let width = headers.length;
    while (width > 0 && headers[width - 1] === "" && t.data.every((row) => (row[width - 1]?.text ?? "") === "")) width--;
    // Round 7, rule 6.1: with no last row the hinted block ends at the first blank row; the rows below are in further
    // blocks (the cell accounting checks they are not lost). With the last row it reads across blank rows.
    const cutAt = g.noLast ? t.data.findIndex((row) => row.every((c) => c.text === "")) : -1;
    const truthData = cutAt === -1 ? t.data : t.data.slice(0, cutAt);
    truths.push({
      hint: g.noLast ? { headerRow: h, headerRows, firstDataRow: first } : { headerRow: h, headerRows, firstDataRow: first, lastDataRow: last },
      headers: headers.slice(0, width),
      rows: truthData.map((row) => row.slice(0, width).map((c) => c.text)),
      key: headerKey(normalizeHeaders(headers.slice(0, width))),
      headerRows,
    });
  });
  const learned: HeaderHoles = {
    learned: [
      ...truths.map((t, k) => layoutOf(t.headers, `t${k}`, t.headerRows)),
      // The sibling of a near-pair layout, and the units row of a table, approved as layouts of their own.
      ...g.tables.flatMap((t, k) => [...(t.decoy ? [layoutOf(t.decoy, `decoy${k}`)] : []), ...(t.units && !t.approvedTwoRow ? [layoutOf(t.units, `units${k}`)] : [])]),
    ],
  };
  return { matrix, text, truths, learned };
}

const csvCell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
const toCsv = (m: string[][]) => m.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";

/** A "fits" that is wrong: not at a true header, through a decoy, or through a layout of fewer than two real names. */
function wrongFit(b: ReadBlock, truths: readonly Truth[], holes: HeaderHoles): string | null {
  const c = chooseHeader(b, holes);
  if (c.kind !== "fits") return null;
  const names = c.fit.recipe.match.headers;
  // Round 7, rule 6.3: two named columns, one of them a real name (this checked two real names in round 6).
  const named = names.filter((n) => n !== "" && !/^_\d+$/.test(n)).length;
  if (named < 2 || names.filter((n) => !isUnitOnlyName(n)).length < 1) return `fits ${c.headerRow} through a layout of unit words ${c.fit.name}`;
  if (c.fit.learned && !truths.some((t) => t.key === c.fit.recipe.match.headerKey)) return `fits ${c.headerRow} through ${c.fit.name}, not the table's layout`;
  const at = truths.some((t) => t.hint.headerRow === c.headerRow && (t.hint.headerRows ?? 1) === c.headerRows);
  if (at) return null;
  if (c.fit.learned) return null;
  return `fits ${c.headerRow}x${c.headerRows} ${c.fit.name}`;
}

/** Cells lost or changed: every filled cell is in a header, a data row with the same text, or a listed row. */
function lost(text: readonly string[][], read: SheetRead): string[] {
  const out: string[] = [];
  const covered = new Set<number>();
  const listed = new Set<number>(read.warnings.map((w) => w.row));
  for (const b of read.blocks) {
    for (const w of b.warnings) listed.add(w.row);
    for (let k = 0; k < b.headerRows; k++) {
      const at = b.guess.headerRow + k;
      covered.add(at);
      (text[at] ?? []).forEach((c, j) => c !== "" && !(b.headers[j] ?? "").includes(c) && out.push(`header ${at}:${j}`));
    }
    b.rows.forEach((row, i) => {
      const at = b.firstDataSheetRow + i;
      if (covered.has(at)) out.push(`row ${at} twice`);
      covered.add(at);
      (text[at] ?? []).forEach((c, j) => c !== "" && (row[j] ?? "") !== c && out.push(`cell ${at}:${j} ${JSON.stringify(c)} read ${JSON.stringify(row[j] ?? null)}`));
    });
  }
  text.forEach((r, i) => r.some((c) => c !== "") && !covered.has(i) && !listed.has(i) && out.push(`row ${i} lost`));
  return out;
}

const pad = (rows: readonly (readonly string[])[], w: number) => rows.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ""));
const view = (b: ReadBlock) => ({ headers: b.headers, rows: pad(b.rows, b.headers.length) });
const want = (t: Truth) => ({ headers: t.headers, rows: pad(t.rows, t.headers.length) });
const hinted = (bs: readonly ReadBlock[]) => bs.filter((b) => b.hints !== null);

describe("round 6 acceptance property (sheets and CSV)", () => {
  test("wrong fits 0, inexact hinted reads 0, cells lost 0, known unnamed-below layouts fit", () => {
    const seeds = Number(process.env.R6_SEEDS ?? 300);
    const counts = { files: 0, sheets: 0, csvs: 0, wrongFits: 0, inexactHinted: 0, cellsLost: 0, unnamedBelow: 0, unnamedBelowAsked: 0, fits: 0, asks: 0 };
    const feats = new Map<string, number>();
    for (let seed = 1; seed <= seeds; seed++) {
      const g = generate(seed);
      for (const f of new Set(g.feats)) feats.set(f, (feats.get(f) ?? 0) + 1);
      const label = `seed ${seed} ${g.feats.join(",")}`;
      const { matrix, text, truths, learned } = toFile(g);
      const csvText = toCsv(text);
      counts.files++;
      const hints = truths.map((t) => t.hint);

      const reads: [string, SheetRead, SheetRead][] = [
        ["sheet", readSheet(matrix, { hints }), readSheet(matrix)],
        ["csv", readCsv(csvText, { hints }), readCsv(csvText)],
      ];
      for (const [kind, byHints, guessed] of reads) {
        if (kind === "sheet") counts.sheets++;
        else counts.csvs++;
        const got = hinted(byHints.blocks).map(view);
        if (!Bun.deepEquals(got, truths.map(want))) {
          counts.inexactHinted++;
          expect(got, `${label} ${kind} hinted`).toEqual(truths.map(want));
        }
        for (const read of [byHints, guessed]) {
          const l = lost(text, read);
          counts.cellsLost += l.length;
          expect(l, `${label} ${kind} cells`).toEqual([]);
        }
        for (const b of guessed.blocks) {
          for (const holes of [{}, learned]) {
            const w = wrongFit(b, truths, holes);
            if (w) counts.wrongFits++;
            expect(w, `${label} ${kind} guess`).toBeNull();
          }
          const c = chooseHeader(b, learned);
          if (c.kind === "fits") counts.fits++;
          else counts.asks++;
        }
        if (g.feats.includes("unnamed_below")) {
          counts.unnamedBelow++;
          const b = guessed.blocks[0]!;
          const c = chooseHeader(b, learned);
          const ok = c.kind === "fits" && c.headerRow === truths[0]!.hint.headerRow;
          if (!ok) counts.unnamedBelowAsked++;
          expect(ok, `${label} ${kind} unnamed below: ${JSON.stringify(c).slice(0, 200)}`).toBe(true);
        }
      }
    }
    if (process.env.R6_REPORT) console.log(JSON.stringify({ ...counts, feats: Object.fromEntries(feats) }));
    for (const f of ["unit_layout", "near_sign", "near_count", "remark_sep", "dates", "blank_run", "no_last_row", "unnamed_below", "units", "stacked0", "stacked3", "keyValue", "longLetterhead"]) {
      expect(feats.get(f) ?? 0, f).toBeGreaterThan(seeds / 60);
    }
    expect(counts.fits).toBeGreaterThan(seeds / 4);
  }, 1_200_000);
});
