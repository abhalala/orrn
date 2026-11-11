import { describe, expect, test } from "bun:test";

import { readPdfText, type TextItem } from "./pdf-text";
import type { BlockHints, ReadBlock } from "./types";

// PORTAL-RULES-3 section 3, the acceptance property for PDF text items. Generated pages with titles, letterheads,
// group labels, blank header cells, ragged rows, footers, wrapped cells, one-cell rows, a second table, a continuation
// page and words in number columns, alone and together. A block the reader calls sure must equal the generated table,
// and with the right hints every block must. No real plant data.
//
// One convention, the hint reader's only fixed rule: a wrapped line sits closer than three quarters of the row pitch
// under its cell, and a one-cell row sits at the pitch. The generator keeps to it.

type Kind = "sr" | "party" | "section" | "num";
type Column = { name: string; kind: Kind; x0: number; x1: number; right: boolean };
type Truth = { title: string | null; headers: string[]; rows: string[][]; at: { page: number; headY: number; headerRows: 1 | 2; firstY: number; lastY: number; lastPage: number } };

const CHAR = 5;
const HEIGHT = 10;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return (n: number) => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return (s >>> 8) % n;
  };
}

const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * CHAR, height: HEIGHT });
const PARTIES = ["Om Metals", "Shree Ganesh", "Zenith Traders", "Asha Ent", "Kamal Bros"];
const SECTIONS = ["R 2105", "T 4012", "K 1100", "R 2106"];
const WRAPS = ["long", "anodised", "mill", "8 ft"];
const WORDS = ["Cancelled", "Pending", "not given"];

export const PDF_FEATURES = [
  "title",
  "letterhead",
  "group_labels",
  "blank_header_cell",
  "ragged_row",
  "footer",
  "wrapped_cell",
  "one_cell_row",
  "second_table",
  "continuation",
  "word_in_number",
] as const;
type Feature = (typeof PDF_FEATURES)[number];

const widest = (k: Kind) => (k === "party" ? 14 : k === "section" ? 6 : k === "sr" ? 3 : 4);

/** `wordy`: number columns wide enough for a word such as "not given", so it never touches the next cell. */
function layColumns(rnd: (n: number) => number, spec: { name: string; kind: Kind }[], wordy = false): Column[] {
  let x = 30 + rnd(40);
  return spec.map((c) => {
    const w = Math.max(c.name.length, wordy && c.kind === "num" ? 9 : widest(c.kind)) * CHAR;
    const right = c.kind === "num" ? rnd(2) === 0 : false;
    const col: Column = { ...c, x0: x, x1: x + w, right };
    x += w + (3 + rnd(8)) * CHAR;
    return col;
  });
}
const cellAt = (c: Column, text: string, y: number) => item(text, c.right ? c.x1 - text.length * CHAR : c.x0, y);

type Built = { items: TextItem[]; y: number; rows: string[][]; firstY: number; lastY: number };

/** Data rows from `y` down, at the row pitch. */
function dataRows(
  rnd: (n: number) => number,
  cols: Column[],
  y0: number,
  pitch: number,
  on: Set<Feature>,
  opts: { n: number; startSr: number; ragged: number | null; wordRow: number | null },
): Built {
  const items: TextItem[] = [];
  const rows: string[][] = [];
  let y = y0;
  let lastY = y0;
  for (let r = 0; r < opts.n; r++) {
    const cells = cols.map((c) => {
      if (c.kind === "sr") return String(opts.startSr + r);
      if (c.kind === "party") return PARTIES[rnd(PARTIES.length)]!;
      if (c.kind === "section") return SECTIONS[rnd(SECTIONS.length)]!;
      return String(1 + rnd(9999));
    });
    if (on.has("one_cell_row") && cols[0]!.kind === "party" && r > 0 && rnd(4) === 0) for (let k = 1; k < cells.length; k++) cells[k] = "";
    if (opts.wordRow === r) {
      const nums = cols.map((c, k) => (c.kind === "num" ? k : -1)).filter((k) => k >= 0);
      cells[nums[rnd(nums.length)]!] = WORDS[rnd(WORDS.length)]!;
    }
    cols.forEach((c, k) => {
      if (cells[k] !== "") items.push(cellAt(c, cells[k]!, y));
    });
    if (opts.ragged === r) {
      items.push(item("vip", cols[cols.length - 1]!.x1 + 40, y));
      cells.push("vip");
    }
    lastY = y;
    let next = y - pitch;
    const wrapCol = cols.findIndex((c, k) => k > 0 && (c.kind === "party" || c.kind === "section") && cells[k] !== "");
    if (on.has("wrapped_cell") && wrapCol !== -1 && cells.filter((c) => c !== "").length > 1 && rnd(3) === 0) {
      const w = WRAPS[rnd(WRAPS.length)]!;
      const gap = 6 + rnd(Math.max(1, Math.floor(pitch * 0.7) - 6));
      items.push(item(w, cols[wrapCol]!.x0, y - gap));
      cells[wrapCol] = `${cells[wrapCol]} ${w}`;
      lastY = y - gap;
      next = y - gap - pitch;
    }
    rows.push(cells);
    y = next;
  }
  return { items, y, rows, firstY: y0, lastY };
}

type Case = { pages: TextItem[][]; tables: Truth[]; features: string[] };

export function generatePdf(seed: number, force?: Feature[]): Case {
  const rnd = rng(seed);
  const on = new Set<Feature>();
  if (force) for (const f of force) on.add(f);
  else {
    const chance: Record<Feature, number> = {
      title: 2, letterhead: 6, group_labels: 12, blank_header_cell: 12, ragged_row: 15, footer: 4, wrapped_cell: 4,
      one_cell_row: 5, second_table: 8, continuation: 4, word_in_number: 8,
    };
    for (const f of PDF_FEATURES) if (rnd(chance[f]) === 0) on.add(f);
    if (on.has("second_table")) on.delete("continuation");
  }
  const pitch = 11 + rnd(8);
  const spec: { name: string; kind: Kind }[] = on.has("one_cell_row") || rnd(2) === 0
    ? [{ name: "Party", kind: "party" }, { name: "Section", kind: "section" }, { name: "Pcs", kind: "num" }, { name: "Kg", kind: "num" }]
    : [{ name: "Sr", kind: "sr" }, { name: "Party", kind: "party" }, { name: "Section", kind: "section" }, { name: "Kg", kind: "num" }];
  let groupNames: string[] | null = null;
  if (on.has("group_labels")) {
    // Party, then Kg and Pcs under one or two months.
    spec.splice(0, spec.length, { name: "Party", kind: "party" }, { name: "Kg", kind: "num" }, { name: "Pcs", kind: "num" });
    groupNames = ["Apr 2025"];
    if (rnd(2) === 0) {
      spec.push({ name: "Kg", kind: "num" }, { name: "Pcs", kind: "num" });
      groupNames.push("May 2025");
    }
  }
  const cols = layColumns(rnd, spec, on.has("word_in_number"));
  const items: TextItem[] = [];
  let y = 800;
  const titleParts: string[] = [];
  if (on.has("letterhead")) {
    items.push(item("FOURCUBES EXTRUSIONS", 30 + rnd(20), y), item("Plant 2", 330 + rnd(60), y));
    titleParts.push("FOURCUBES EXTRUSIONS Plant 2");
    y -= pitch + rnd(10);
  }
  if (on.has("title")) {
    if (rnd(2) === 0) {
      items.push(item("Party: Om Metals", 30 + rnd(30), y), item("Date: 31.10.2025", 260 + rnd(80), y));
      titleParts.push("Party: Om Metals Date: 31.10.2025");
    } else {
      const t = ["PACKING LIST", "Despatch Register 2025-26", "ORDER BOOK"][rnd(3)]!;
      items.push(item(t, 40 + rnd(120), y));
      titleParts.push(t);
    }
    y -= pitch + rnd(10);
  }
  const headY = y;
  let headers = cols.map((c) => c.name);
  let headerRows: 1 | 2 = 1;
  if (groupNames) {
    // The group row: Party, and each month over its Kg column. Then the sub-column row.
    items.push(item("Party", cols[0]!.x0, y));
    groupNames.forEach((g, i) => items.push(item(g, cols[1 + i * 2]!.x0, y)));
    y -= pitch;
    cols.slice(1).forEach((c) => items.push(cellAt(c, c.name, y)));
    headers = ["Party", ...groupNames.flatMap((g) => [`${g} Kg`, `${g} Pcs`])];
    headerRows = 2;
  } else {
    const blank = on.has("blank_header_cell") ? 1 + rnd(cols.length - 1) : -1;
    cols.forEach((c, k) => {
      if (k !== blank) items.push(cellAt(c, c.name, y));
    });
    if (blank >= 0) headers[blank] = "";
  }
  y -= pitch;
  const n = 2 + rnd(6);
  const t1 = dataRows(rnd, cols, y, pitch, on, {
    n,
    startSr: 1,
    ragged: on.has("ragged_row") ? rnd(n) : null,
    wordRow: on.has("word_in_number") ? rnd(Math.min(3, n)) : null,
  });
  items.push(...t1.items);
  if (on.has("ragged_row")) headers.push("");
  const pad = (r: string[]) => [...r, ...Array<string>(Math.max(0, headers.length - r.length)).fill("")];
  const first: Truth = {
    title: titleParts.length > 0 ? titleParts.join(" ") : null,
    headers,
    rows: t1.rows.map(pad),
    at: { page: 0, headY, headerRows, firstY: t1.firstY, lastY: t1.lastY, lastPage: 0 },
  };
  const tables: Truth[] = [first];
  const pages: TextItem[][] = [items];
  y = t1.y;
  if (on.has("second_table")) {
    const mode = rnd(3);
    let titled: string | null = null;
    if (mode === 0) {
      let sx = cols[0]!.x0;
      while (cols.some((c) => c !== cols[0] && Math.abs(c.x0 - sx) <= 2 * CHAR)) sx += 3 * CHAR;
      items.push(item("Summary", sx, y));
      titled = "Summary";
      y -= pitch;
    } else if (mode === 1) y -= HEIGHT * 5;
    const cols2 = layColumns(rnd, [{ name: "Party", kind: "party" }, { name: "Bundles", kind: "num" }, { name: "Total Kg", kind: "num" }]);
    const head2 = y;
    cols2.forEach((c) => items.push(cellAt(c, c.name, y)));
    y -= pitch;
    const t2 = dataRows(rnd, cols2, y, pitch, new Set(), { n: 1 + rnd(4), startSr: 1, ragged: null, wordRow: null });
    items.push(...t2.items);
    tables.push({ title: titled, headers: cols2.map((c) => c.name), rows: t2.rows, at: { page: 0, headY: head2, headerRows: 1, firstY: t2.firstY, lastY: t2.lastY, lastPage: 0 } });
    y = t2.y;
  }
  if (on.has("continuation")) {
    const p2: TextItem[] = [];
    let y2 = 800;
    if (rnd(2) === 0) {
      // The title and the header again on top of page 2.
      if (first.title) {
        p2.push(item(first.title, 50, y2));
        y2 -= pitch + 5;
      }
      if (groupNames) {
        p2.push(item("Party", cols[0]!.x0, y2));
        groupNames.forEach((g, i) => p2.push(item(g, cols[1 + i * 2]!.x0, y2)));
        y2 -= pitch;
        cols.slice(1).forEach((c) => p2.push(cellAt(c, c.name, y2)));
      } else cols.forEach((c, k) => headers[k] !== "" && p2.push(cellAt(c, c.name, y2)));
      y2 -= pitch;
    }
    const t3 = dataRows(rnd, cols, y2, pitch, on, { n: 1 + rnd(4), startSr: n + 1, ragged: null, wordRow: null });
    p2.push(...t3.items);
    first.rows.push(...t3.rows.map(pad));
    first.at.lastPage = 1;
    first.at.lastY = t3.lastY;
    pages.push(p2);
  }
  const last = pages.length - 1;
  if (on.has("footer")) {
    const page = pages[last]!;
    const lowY = last === 0 ? y : Math.min(...page.map((i) => i.y)) - pitch;
    if (rnd(2) === 0) page.push(item("Authorised Signatory", cols[0]!.x0, lowY));
    else page.push(item("Thank you", 40 + rnd(100), lowY - HEIGHT * 6));
  }
  return { pages, tables, features: [...on] };
}

/** Line number of a y on a page: lines are the distinct baselines, top first. */
function lineOf(page: readonly TextItem[], y: number): number {
  const ys = [...new Set(page.map((i) => i.y))].sort((a, b) => b - a);
  return ys.indexOf(y);
}

export function truthHints(c: Case): BlockHints[] {
  return c.tables.map((t) => ({
    page: t.at.page + 1,
    headerRow: lineOf(c.pages[t.at.page]!, t.at.headY),
    headerRows: t.at.headerRows,
    firstDataRow: lineOf(c.pages[t.at.page]!, t.at.firstY),
    lastDataRow: lineOf(c.pages[t.at.lastPage]!, t.at.lastY),
    lastPage: t.at.lastPage + 1,
  }));
}

const view = (b: ReadBlock) => ({ title: b.title, headers: b.headers, rows: b.rows });
const viewTruth = (t: Truth) => ({ title: t.title, headers: t.headers, rows: t.rows });

describe("pdf reader property: sure means right, hints mean right", () => {
  test("generated pages, each feature alone and in real-looking mixes", () => {
    const cases: Case[] = [];
    let seed = 1;
    for (const f of PDF_FEATURES) for (let k = 0; k < 60; k++) cases.push(generatePdf(seed++, [f]));
    for (let k = 0; k < 300; k++) cases.push(generatePdf(seed++, [PDF_FEATURES[k % 11]!, PDF_FEATURES[(k * 4 + 3) % 11]!]));
    for (let k = 0; k < 1500; k++) cases.push(generatePdf(seed++));
    let sure = 0;
    for (const c of cases) {
      const label = `${c.features.join(",")} seed`;
      const guessed = readPdfText(c.pages);
      guessed.blocks.forEach((b, i) => {
        if (b.confidence !== "sure") return;
        sure++;
        expect(guessed.blocks.length, label).toBe(c.tables.length);
        expect(view(b), label).toEqual(viewTruth(c.tables[i]!));
      });
      const hinted = readPdfText(c.pages, { hints: truthHints(c) });
      expect(hinted.blocks.map(view), `${label} ${JSON.stringify(truthHints(c))}`).toEqual(c.tables.map(viewTruth));
    }
    expect(sure).toBeGreaterThan(200);
  });
});
