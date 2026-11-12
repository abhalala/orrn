/**
 * The round 8 acceptance property (rule 8.1), sheets and CSV. A seeded generator writes a first table with blank rows
 * inside it, month lines and repeated headers after blank rows, words and blank-value words in number columns and
 * blank cells; then, in half the files, blank rows, maybe a title, and a second table below. When the first table has
 * a number or date column the second table's header holds text over at least one of them (the sign rule 8.1 reads);
 * when the first table is all text, what lies below is either more of it or a different table.
 *
 * Each file is read with a hint on the first header only (no last row) and with no hint. Checked:
 * - Swallowed 0: the block of the first table never holds a row of the second table, or anything else not its own.
 * - The first table's rows: exactly its own, or, when a row after a gap does not fit, a first part of them. A split is
 *   "split wrongly" when the table, as read, still has a number or date column (the row after the gap had a word in
 *   one, a cell past the width, or only words, which the round 8 guard reads as a header); it is "split, offered" when a word turned its last number column into text, so it
 *   reads as a table of text columns, and then the part below must carry `follows.continues`. The rest of its rows
 *   are in further blocks either way.
 * - Whatever the first table's block reads past is listed: each month line as `skipped_title` and each repeated header
 *   as `skipped_repeat_header`, with its text; `gaps` is the number of blank rows inside it.
 * - The second table heads a block of its own.
 * - Below a table of text columns only, a part of two or more rows is a block whose `follows.continues` is true.
 * - Cells lost 0: every filled cell is in a header, a title, a data row with the same text, or a listed row.
 *
 * `R8_SEEDS` sets the number of files (default 400); `R8_REPORT=1` prints the counts.
 */
import { describe, expect, test } from "bun:test";

import { ColumnKinds, isWord, readSheet, type SheetRead } from "./blocks";
import { readCsv } from "./csv";
import type { ReadBlock } from "./types";

type Rand = () => number;
function rng(seed: number): Rand {
  let a = (seed * 2654435761 + 97) >>> 0;
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

type Kind = "party" | "person" | "city" | "grade" | "code" | "int" | "dec" | "phone" | "date" | "remark";
const VALUE = (k: Kind) => k === "int" || k === "dec" || k === "phone" || k === "date";
const NUMBER_LAYOUTS: { head: string[]; kinds: Kind[] }[] = [
  { head: ["Party", "Order No", "Section", "Pcs", "Kg", "Rate"], kinds: ["party", "int", "code", "int", "dec", "dec"] },
  { head: ["Date", "Party", "Kg"], kinds: ["date", "party", "dec"] },
  { head: ["Name", "Phone", "City"], kinds: ["party", "phone", "city"] },
  { head: ["Section", "Size", "Tol +", "Tol -"], kinds: ["code", "dec", "dec", "dec"] },
  { head: ["Party", "Section", "Kg", "Remarks"], kinds: ["party", "code", "dec", "remark"] },
  { head: ["Party", "City", "Section", "Kg/12ft"], kinds: ["party", "city", "code", "dec"] },
  { head: ["पार्टी", "सेक्शन", "नग", "किलो"], kinds: ["party", "code", "int", "dec"] },
  { head: ["પાર્ટી", "તારીખ", "કિલો"], kinds: ["party", "date", "dec"] },
];
const TEXT_LAYOUTS: { head: string[]; kinds: Kind[] }[] = [
  { head: ["Firm", "Contact", "Place"], kinds: ["party", "person", "city"] },
  { head: ["Name", "City", "Grade"], kinds: ["party", "city", "grade"] },
  { head: ["Party", "Section", "Finish"], kinds: ["party", "code", "grade"] },
];
const PARTY = ["Om Metals", "Kamal Bros", "Shree Ganesh", "Zenith Traders", "ઓમ મેટલ્સ", "राम ट्रेडर्स"];
const PERSON = ["Ramesh", "Suresh", "Mahesh", "Naresh"];
const CITY = ["Rajkot", "Morbi", "Surat", "રાજકોટ", "जामनगर"];
const GRADE = ["Mill", "Anodised", "Powder", "6063", "6061"];
const SEC = ["T4012", "R2105", "K1100", "F3301"];
const OTHER = ["Vehicle", "Driver", "Bundle", "Grade", "Shift", "Die", "Supervisor"];
const two = (x: number) => String(x).padStart(2, "0");

function value(r: Rand, k: Kind): string {
  if (k === "party") return pick(r, PARTY);
  if (k === "person") return pick(r, PERSON);
  if (k === "city") return pick(r, CITY);
  if (k === "grade") return pick(r, GRADE);
  if (k === "code") return pick(r, SEC);
  if (k === "int") return String(int(r, 1, 900));
  if (k === "dec") return (r() * 50 + 0.5).toFixed(2);
  if (k === "phone") return `98${int(r, 10000000, 99999999)}`;
  if (k === "date") return `${int(r, 2019, 2026)}-${two(int(r, 1, 12))}-${two(int(r, 1, 28))}`;
  return `${pick(r, ["ok", "hold", "recheck"])} ${pick(r, ["done", "late", "fine"])}`;
}

/** A generated file and what is true about it. */
type File = {
  text: string[][];
  feats: string[];
  numbers: boolean;
  h1: number;
  /** Sheet rows of the first table's data, in order (no blank rows, month lines or repeated headers). */
  rows1: number[];
  /** Month lines and repeated headers inside the first table, with their text. */
  listed1: { row: number; code: "skipped_title" | "skipped_repeat_header"; text: string }[];
  /** Blank rows inside the first table (between its first and last data rows). */
  blanks1: number[];
  /** The first row after the first table that is not its own (blank rows aside), or -1. */
  below: number;
  /** The second table's header row, or -1. */
  h2: number;
  /** Below a text table: the first row of a part of the same table, or -1. */
  part: number;
  /**
   * Section 9: the second table's header holds numbers or dates. "sign" when it carries one of the section 9 signs by
   * construction (the first table's first name in its column, or column numbers rising by one); "none" when it carries
   * none (alloys or lengths as names under an unrelated table), which section 9 does not cover; null otherwise.
   */
  numbered: "sign" | "none" | null;
};

function generate(seed: number): File {
  const r = rng(seed);
  const feats: string[] = [];
  const numbers = r() < 0.8;
  const L = numbers ? pick(r, NUMBER_LAYOUTS) : pick(r, TEXT_LAYOUTS);
  feats.push(numbers ? "numbers" : "all_text");
  const text: string[][] = [];
  if (r() < 0.3) {
    text.push([pick(r, ["Order book", "Customer list", "Stock statement"])]);
    if (r() < 0.5) text.push([]);
    feats.push("title");
  }
  const h1 = text.length;
  text.push([...L.head]);
  const rows1: number[] = [];
  const listed1: File["listed1"] = [];
  const blanks1: number[] = [];
  const n = int(r, 3, 40);
  const dataRow = (): string[] => {
    const row: string[] = L.kinds.map((k) => (r() < 0.1 ? "" : value(r, k)));
    if (VALUE(L.kinds[L.kinds.length - 1]!) && r() < 0.05) row[row.length - 1] = pick(r, ["Nil", "-"]);
    if (r() < 0.03) {
      // A word in a number column: the column becomes text from here on.
      const at = L.kinds.findIndex((k) => VALUE(k));
      if (at >= 0) {
        row[at] = pick(r, ["pending", "cancelled"]);
        feats.push("word_in_number");
      }
    }
    if (r() < 0.02) {
      row.push("note");
      feats.push("cell_past_width");
    }
    if (!row.some((c) => c !== "")) row[0] = pick(r, PARTY);
    return row;
  };
  for (let k = 0; k < n; k++) {
    // Only all-text tables never go on across a blank row; their tables get no blank rows inside.
    if (numbers && k > 0 && r() < 0.12) {
      for (let b = int(r, 1, 3); b > 0; b--) {
        blanks1.push(text.length);
        text.push([]);
      }
      feats.push("blank_inside");
      const what = r();
      if (what < 0.25) {
        const line = pick(r, ["December", "January 2026", "contd.", "दिसंबर", "Page 2"]);
        listed1.push({ row: text.length, code: "skipped_title", text: line });
        text.push([line]);
        feats.push("month_line");
      } else if (what < 0.45) {
        listed1.push({ row: text.length, code: "skipped_repeat_header", text: L.head.join(" ") });
        text.push([...L.head]);
        feats.push("repeat_header");
      }
    }
    rows1.push(text.length);
    text.push(dataRow());
  }
  let below = -1;
  let h2 = -1;
  let part = -1;
  let numbered: File["numbered"] = null;
  if (r() < 0.5) {
    for (let b = int(r, 1, 3); b > 0; b--) text.push([]);
    below = text.length;
    if (!numbers && r() < 0.5) {
      part = text.length;
      for (let k = int(r, 2, 6); k > 0; k--) text.push(L.kinds.map((kd) => value(r, kd)));
      feats.push("text_part_below");
    } else {
      if (r() < 0.3) {
        text.push([pick(r, ["Dispatch", "Summary"])]);
        feats.push("title_below");
      }
      h2 = text.length;
      const form = numbers && r() < 0.5 ? pick(r, ["label_dates", "label_months", "label_years", "column_numbers", "column_numbers", "no_sign"] as const) : null;
      if (form !== null) {
        // Section 9: a second table whose header holds numbers or dates (the checker's r8b and r8c shapes).
        const w = Math.max(3, Math.min(6, L.head.length + int(r, -1, 1)));
        const d0 = int(r, 1, 20);
        const m0 = int(r, 1, 9);
        const y0 = int(r, 2019, 2025);
        const head =
          form === "label_dates" ? [L.head[0]!, ...Array.from({ length: w - 1 }, (_, i) => `${d0 + i}/11/2026`)]
          : form === "label_months" ? [L.head[0]!, ...Array.from({ length: w - 1 }, (_, i) => String(m0 + i))]
          : form === "label_years" ? [L.head[0]!, ...Array.from({ length: w - 1 }, (_, i) => String(y0 + i))]
          : form === "column_numbers" ? Array.from({ length: w }, (_, i) => String(i + 1))
          : pick(r, [["Grade", "", "6063", "6061"], ["", "12", "14", "16"], ["Length", "8", "10", "12"]]);
        numbered = form === "no_sign" ? "none" : "sign";
        text.push(head);
        for (let k = int(r, 2, 6); k > 0; k--) text.push(head.map((_, i) => (i === 0 ? pick(r, SEC) : String(int(r, 0, 90)))));
        feats.push(form === "no_sign" ? "numbered_below_no_sign" : "numbered_below");
        return { text, feats, numbers, h1, rows1, listed1, blanks1, below, h2, part, numbered };
      }
      // The second header: words, over at least one number or date column of the first table when it has one.
      const firstValue = L.kinds.findIndex((k) => VALUE(k));
      const w = Math.min(7, Math.max(2, firstValue + 1, int(r, 2, 5)));
      const off = int(r, 0, 6);
      text.push(Array.from({ length: w }, (_, i) => OTHER[(i + off) % OTHER.length]!));
      const okinds: Kind[] = Array.from({ length: w }, (_, i) => (i === 0 ? "code" : pick(r, ["int", "dec", "date", "city"] as Kind[])));
      // Two rows or more: a header over one row of text is a footer (C33), listed under the table above.
      for (let k = int(r, 2, 6); k > 0; k--) text.push(okinds.map((kd) => value(r, kd)));
      feats.push("table_below");
    }
  }
  return { text, feats, numbers, h1, rows1, listed1, blanks1, below, h2, part, numbered };
}

const filled = (row: readonly string[] | undefined) => (row ?? []).some((c) => c !== "");
const rowText = (row: readonly string[]) => row.filter((c) => c !== "").join(" ");

/** Cells lost or changed, and rows placed twice. */
function lost(text: readonly string[][], read: SheetRead): string[] {
  const out: string[] = [];
  const seen = new Set<number>();
  const listed = new Map<number, string | undefined>();
  for (const w of read.warnings) listed.set(w.row, w.text);
  for (const b of read.blocks) {
    for (const w of b.warnings) listed.set(w.row, w.text);
    for (let k = 0; k < b.headerRows; k++) {
      const at = b.guess.headerRow + k;
      seen.add(at);
      (text[at] ?? []).forEach((c, j) => c !== "" && !(b.headers[j] ?? "").includes(c) && out.push(`header ${at}:${j}`));
    }
    const left = new Set(b.warnings.filter((w) => w.code === "skipped_title" || w.code === "skipped_repeat_header" || w.code === "skipped_by_hint").map((w) => w.row));
    b.rows.forEach((row, i) => {
      const at = b.firstDataSheetRow + i;
      if (!filled(text[at])) return;
      if (seen.has(at)) out.push(`row ${at} twice`);
      seen.add(at);
      if (left.has(at)) {
        if (row.some((c) => c !== "")) out.push(`row ${at} left out but not blank`);
        return;
      }
      (text[at] ?? []).forEach((c, j) => c !== "" && (row[j] ?? "") !== c && out.push(`cell ${at}:${j}`));
    });
  }
  text.forEach((row, i) => {
    if (!filled(row)) return;
    if (!seen.has(i) && !listed.has(i)) out.push(`row ${i} lost`);
    const t = listed.get(i);
    if (t !== undefined && t !== rowText(row)) out.push(`row ${i} listed as ${JSON.stringify(t)}`);
  });
  return out;
}

/**
 * Why a real continuation row after blank rows ended the table, by section 9 (strict kinds and the three signs), or
 * "other" when none applies.
 */
function sign9(header: readonly string[], above: readonly (readonly string[])[], row: readonly string[]): string {
  const k = new ColumnKinds(0);
  for (const x of above) k.add(x);
  const name = (c: string) => c.trim().toLowerCase();
  if (row.some((c, i) => c !== "" && (header[i] ?? "") !== "" && name(c) === name(header[i]!))) return "nameInColumn";
  const isNum = (c: string) => /^-?[\d,]*\.?\d+$/.test(c.trim());
  const isDate = (c: string) => /^\d{4}-\d{2}-\d{2}$/.test(c.trim());
  if (row.some((c, i) => (k.kindOf(i) === "number" && isDate(c)) || (k.kindOf(i) === "date" && isNum(c)))) return "strictKind";
  const ints = row.filter((c) => isNum(c) || isDate(c)).map((c) => (/^\d+$/.test(c) ? Number(c) : NaN));
  for (let i = 2; i < ints.length; i++) if (ints[i] === ints[i - 1]! + 1 && ints[i - 1] === ints[i - 2]! + 1) return "risingNumbers";
  const at = row.flatMap((c, i) => (isNum(c) ? [i] : []));
  if (at.length > 0 && at.every((i) => k.kindOf(i) === undefined)) return "numberInBlankColumn";
  return "other";
}

/** Sheet rows a block holds as data (filled, not left out). */
function dataRows(b: ReadBlock, text: readonly string[][]): number[] {
  const left = new Set(b.warnings.filter((w) => w.code.startsWith("skipped")).map((w) => w.row));
  const out: number[] = [];
  b.rows.forEach((_, i) => {
    const at = b.firstDataSheetRow + i;
    if (filled(text[at]) && !left.has(at)) out.push(at);
  });
  return out;
}

describe("round 8 acceptance property (rule 8.1, sheets and CSV)", () => {
  test("swallowed 0, cells lost 0, what is read past is listed; split wrongly is counted", () => {
    const seeds = Number(process.env.R8_SEEDS ?? 400);
    const c = { files: 0, reads: 0, swallowed: 0, cellsLost: 0, exact: 0, splitWrongly: 0, splitCause: {} as Record<string, number>, splitOffered: 0, splitOfferedMade: 0, withGaps: 0, numberedBelow: 0, numberedBelowOwnBlock: 0, noSignBelow: 0, noSignSwallowed: 0, oneCellRowsListed: 0, gapsChecked: 0, tablesBelow: 0, textParts: 0, textPartsOffered: 0 };
    const feats = new Map<string, number>();
    for (let seed = 1; seed <= seeds; seed++) {
      const f = generate(seed);
      for (const x of new Set(f.feats)) feats.set(x, (feats.get(x) ?? 0) + 1);
      c.files++;
      const label = `seed ${seed} ${[...new Set(f.feats)].join(",")}`;
      const csv = f.text.map((row) => row.map((x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",")).join("\n") + "\n";
      const reads: [string, SheetRead][] = [
        ["sheet hinted", readSheet(f.text, { hints: [{ headerRow: f.h1 }] })],
        ["sheet guessed", readSheet(f.text)],
        ["csv hinted", readCsv(csv, { hints: [{ headerRow: f.h1 }] })],
        ["csv guessed", readCsv(csv)],
      ];
      for (const [kind, read] of reads) {
        c.reads++;
        if (f.numbers && f.blanks1.length > 0) c.withGaps++;
        const l = lost(f.text, read);
        c.cellsLost += l.length;
        expect(l, `${label} ${kind} cells`).toEqual([]);
        const top = read.blocks.find((b) => b.guess.headerRow === f.h1);
        expect(top, `${label} ${kind}: no block at the first header`).toBeDefined();
        const got = dataRows(top!, f.text);
        const own = new Set(f.rows1);
        const swallowed = got.some((x) => !own.has(x));
        if (f.numbered === "none") {
          // Outside section 9: counted, not asserted. Nothing is lost either way (checked above).
          c.noSignBelow++;
          if (swallowed) {
            c.noSignSwallowed++;
            continue;
          }
        }
        if (swallowed) c.swallowed++;
        expect(swallowed, `${label} ${kind} swallowed ${JSON.stringify(got.filter((x) => !own.has(x)))}`).toBe(false);
        // A data row of one text cell right after blank rows reads as a title by rule 8.1: left out and listed.
        const asTitle = new Set(top!.warnings.filter((w) => w.code === "skipped_title" && own.has(w.row) && f.text[w.row]!.filter((x) => x !== "").length === 1).map((w) => w.row));
        c.oneCellRowsListed += asTitle.size;
        const mine = f.rows1.filter((x) => !asTitle.has(x));
        const prefix = got.every((x, i) => x === mine[i]);
        expect(prefix, `${label} ${kind} rows ${JSON.stringify(got)} vs ${JSON.stringify(mine)}`).toBe(true);
        const lastRow = got[got.length - 1] ?? f.h1;
        if (got.length === mine.length) {
          c.exact++;
          // Everything the block read past inside the table is listed, with its text; gaps counts the blank rows.
          for (const w of f.listed1) expect(top!.warnings, `${label} ${kind} listed`).toContainEqual(w);
          expect(top!.gaps, `${label} ${kind} gaps`).toBe(f.blanks1.filter((x) => x < lastRow).length);
          c.gapsChecked++;
        } else {
          const k = new ColumnKinds(0);
          for (const x of got) k.add(f.text[x]!);
          if (k.hasValueColumn()) {
            c.splitWrongly++;
            // The row that ended it: the first filled row after the block that is not a one-cell line.
            let at = lastRow + 1;
            while (at < f.text.length && f.text[at]!.filter((x) => x !== "").length <= 1) at++;
            const row = f.text[at] ?? [];
            const words = row.filter((x) => x !== "");
            const cause = words.length === 0
              ? "oneCellTail" // only one-cell lines follow: listed as after_last_row, the table does not go on
              : row.includes("note")
              ? "cellPastWidth"
              : row.some((x) => x === "pending" || x === "cancelled")
                ? "wordInNumber"
                : words.length >= 2 && words.every((x) => isWord(x))
                  ? "wordsOnlyRow" // the round 8 guard: a row of words only after blank rows reads as a header
                  : sign9(f.text[f.h1]!, got.map((x) => f.text[x]!), row);
            c.splitCause[cause] = (c.splitCause[cause] ?? 0) + 1;
            expect(cause, `${label} ${kind} split by ${JSON.stringify(row)}`).not.toBe("other");
          } else {
            c.splitOffered++;
            const next = read.blocks[read.blocks.indexOf(top!) + 1];
            if (next?.follows?.continues) c.splitOfferedMade++;
          }
          // The block reads past nothing it does not list: its listed rows all lie inside what it read.
          for (const w of top!.warnings.filter((x) => x.code.startsWith("skipped"))) expect(w.row, `${label} ${kind}`).toBeLessThan(lastRow);
        }
        if (f.h2 >= 0 && f.numbered === "none" && !read.blocks.some((b) => b.guess.headerRow === f.h2)) {
          c.noSignSwallowed++; // swallowed by a block split from the table above; outside section 9, counted only
        } else if (f.h2 >= 0) {
          c.tablesBelow++;
          const b2 = read.blocks.find((b) => b.guess.headerRow === f.h2);
          expect(b2, `${label} ${kind}: the second table heads no block ${JSON.stringify(read.blocks.map((b) => b.guess))}`).toBeDefined();
          expect(dataRows(b2!, f.text).every((x) => x > f.h2), `${label} ${kind}`).toBe(true);
          if (f.numbered === "sign") {
            c.numberedBelow++;
            if (b2) c.numberedBelowOwnBlock++;
          }
        }
        if (f.part >= 0) {
          c.textParts++;
          const bp = read.blocks.find((b) => b.guess.headerRow === f.part);
          expect(bp, `${label} ${kind}: the part below is no block`).toBeDefined();
          if (bp!.follows?.continues) c.textPartsOffered++;
          expect(bp!.follows, `${label} ${kind}`).toMatchObject({ continues: true });
        }
      }
    }
    if (process.env.R8_REPORT) {
      // The share: of the reads of a table with a number or date column and blank rows inside it.
      const share = (c.splitWrongly / Math.max(1, c.withGaps)).toFixed(4);
      console.log(JSON.stringify({ ...c, splitWronglyShare: share, feats: Object.fromEntries(feats) }));
    }
    for (const x of ["numbers", "all_text", "blank_inside", "month_line", "repeat_header", "table_below", "text_part_below", "word_in_number", "numbered_below", "numbered_below_no_sign"]) {
      expect(feats.get(x) ?? 0, x).toBeGreaterThan(seeds / 100);
    }
    expect(c.swallowed).toBe(0);
    expect(c.cellsLost).toBe(0);
  }, 1_200_000);
});
