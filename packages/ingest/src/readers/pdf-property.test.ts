import { describe, expect, test } from "bun:test";

import { readPdfText, type TextItem } from "./pdf-text";

// Generated pages: tables with known columns at random x positions and row pitches, with titles, footers, wrapped
// lines, one-cell rows, a second table and a continuation page. The reader must return exactly the generated cells,
// or say in a warning that it could not. No real plant data.

type Kind = "sr" | "party" | "section" | "num";
type Column = { name: string; kind: Kind; x0: number; x1: number; right: boolean };
type Table = { title: string | null; headers: string[]; rows: string[][] };

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
const WRAPS = ["long", "anodised", "mill finish", "8 ft"];

/** Lay out columns left to right with random gaps of 3 to 10 characters. */
function layColumns(rnd: (n: number) => number, spec: { name: string; kind: Kind }[], widest: (k: Kind) => number): Column[] {
  let x = 30 + rnd(40);
  return spec.map((c) => {
    const w = Math.max(c.name.length, widest(c.kind)) * CHAR;
    const col: Column = { ...c, x0: x, x1: x + w, right: c.kind === "num" || c.kind === "sr" ? rnd(2) === 0 : false };
    x += w + (3 + rnd(8)) * CHAR;
    return col;
  });
}

const widest = (k: Kind) => (k === "party" ? 14 : k === "section" ? 6 : k === "sr" ? 2 : 4);

function cellAt(col: Column, text: string, y: number): TextItem {
  return item(text, col.right ? col.x1 - text.length * CHAR : col.x0, y);
}

type Built = { items: TextItem[]; y: number; table: Table };

/**
 * One table from `y` downward. Data rows always hold their numbers, so no data row reads like a header. A wrapped
 * line goes under a filled text cell outside the first column; a one-cell row holds only the first column (a party).
 */
function buildTable(
  rnd: (n: number) => number,
  cols: Column[],
  y0: number,
  pitch: number,
  opts: { rows: number; wraps: boolean; oneCell: boolean; header: boolean; startSr: number },
): Built {
  const items: TextItem[] = [];
  let y = y0;
  if (opts.header) {
    for (const c of cols) items.push(item(c.name, c.right ? c.x1 - c.name.length * CHAR : c.x0, y));
    y -= pitch;
  }
  const rows: string[][] = [];
  for (let r = 0; r < opts.rows; r++) {
    const cells = cols.map((c) => {
      if (c.kind === "sr") return String(opts.startSr + r);
      if (c.kind === "party") return PARTIES[rnd(PARTIES.length)]!;
      if (c.kind === "section") return rnd(5) === 0 ? "" : SECTIONS[rnd(SECTIONS.length)]!;
      return String(1 + rnd(9999));
    });
    if (opts.oneCell && cols[0]!.kind === "party" && rnd(5) === 0) {
      for (let k = 1; k < cells.length; k++) cells[k] = "";
    }
    cols.forEach((c, k) => {
      if (cells[k] !== "") items.push(cellAt(c, cells[k]!, y));
    });
    let next = y - pitch;
    const wrapCol = cols.findIndex((c, k) => k > 0 && (c.kind === "party" || c.kind === "section") && cells[k] !== "");
    if (opts.wraps && wrapCol !== -1 && cells.filter((c) => c !== "").length > 1 && rnd(3) === 0) {
      // Wrapped text stays inside its cell's column.
      const fit = WRAPS.filter((x) => x.length * CHAR <= cols[wrapCol]!.x1 - cols[wrapCol]!.x0);
      const w = fit[rnd(fit.length)] ?? "x";
      const gap = Math.max(7, Math.round(pitch * (0.6 + rnd(41) / 100)));
      items.push(item(w, cols[wrapCol]!.x0, y - gap));
      cells[wrapCol] = `${cells[wrapCol]} ${w}`;
      next = y - gap - pitch;
    }
    rows.push(cells);
    y = next;
  }
  return { items, y, table: { title: null, headers: cols.map((c) => c.name), rows } };
}

type Page = { items: TextItem[] };
type Case = { pages: Page[]; tables: Table[]; label: string };

function generate(seed: number): Case {
  const rnd = rng(seed);
  const pitch = 11 + rnd(8);
  const first: { name: string; kind: Kind }[] = rnd(2) === 0
    ? [{ name: "Sr", kind: "sr" }, { name: "Section", kind: "section" }, { name: "Pcs", kind: "num" }, { name: "Kg", kind: "num" }]
    : [{ name: "Party", kind: "party" }, { name: "Section", kind: "section" }, { name: "Pcs", kind: "num" }, { name: "Kg", kind: "num" }];
  if (rnd(2) === 0) first.splice(2, 0, { name: "Party", kind: "party" });
  const unique = first.filter((c, i) => first.findIndex((d) => d.name === c.name) === i);
  const cols = layColumns(rnd, unique, widest);
  const items: TextItem[] = [];
  let y = 800;
  const titleParts: string[] = [];
  const titleKind = rnd(4);
  if (titleKind === 1 || titleKind === 3) {
    items.push(item("Party: Om Metals", 30 + rnd(30), y), item("Date: 31.10.2025", 260 + rnd(80), y));
    titleParts.push("Party: Om Metals Date: 31.10.2025");
    y -= pitch + rnd(10);
  }
  if (titleKind === 2 || titleKind === 3) {
    const t = ["PACKING LIST", "Despatch Register 2025-26", "ORDER BOOK"][rnd(3)]!;
    items.push(item(t, 40 + rnd(120), y));
    titleParts.push(t);
    y -= pitch + rnd(10);
  }
  const t1 = buildTable(rnd, cols, y, pitch, { rows: 2 + rnd(6), wraps: true, oneCell: true, header: true, startSr: 1 });
  items.push(...t1.items);
  t1.table.title = titleParts.length > 0 ? titleParts.join(" ") : null;
  y = t1.y;
  const tables: Table[] = [t1.table];
  const shape = rnd(4);
  const labels = [`seed ${seed}`, `pitch ${pitch}`, `title ${titleKind}`, `shape ${shape}`];
  const pages: Page[] = [{ items }];
  if (shape === 1) {
    // A second table under a one-cell Summary line, after a blank gap, or right under the first with no heading line
    // (within 3 line heights, C-new-6).
    const mode = rnd(3);
    const spaced = mode === 1;
    const bare = mode === 2;
    // A heading lines up with the table's left edge, or with no cell at all: a short line that starts exactly where
    // a text cell starts, one row pitch below it, reads as a wrapped line of that cell.
    let sx = rnd(2) === 0 ? cols[0]!.x0 : 30 + rnd(200);
    while (cols.some((c) => c !== cols[0] && Math.abs(c.x0 - sx) <= 2 * CHAR)) sx += 3 * CHAR;
    if (mode === 0) items.push(item("Summary", sx, y));
    y -= spaced ? HEIGHT * 5 : bare ? rnd(HEIGHT) : pitch;
    const cols2 = layColumns(rnd, [{ name: "Party", kind: "party" }, { name: "Bundles", kind: "num" }, { name: "Total Kg", kind: "num" }], widest);
    const t2 = buildTable(rnd, cols2, y, pitch, { rows: 1 + rnd(4), wraps: false, oneCell: false, header: true, startSr: 1 });
    items.push(...t2.items);
    t2.table.title = mode === 0 ? "Summary" : null;
    // A party-only last row right above the next header has the shape of a heading at the left edge: by the reader's
    // rule the last waiting line heads the next table, so it is that table's title.
    const lastRow = t1.table.rows[t1.table.rows.length - 1]!;
    if (bare && lastRow.filter((c) => c !== "").length === 1) {
      t1.table.rows.pop();
      t2.table.title = lastRow[0]!;
    }
    tables.push(t2.table);
    labels.push(spaced ? "second after gap" : bare ? "second with no heading" : "second after Summary");
  } else if (shape === 2) {
    // Footers: a signature line at the pitch, a note after a gap, a page number.
    const f = rnd(3);
    if (f === 0) items.push(item("Authorised Signatory", cols[0]!.x0, y));
    if (f === 1) items.push(item("Thank you", 40 + rnd(100), y - HEIGHT * 6));
    if (f === 2) items.push(item("Page 1 of 1", 200 + rnd(50), y - HEIGHT * 2));
    labels.push(`footer ${f}`);
  } else if (shape === 3) {
    // A continuation page: the same columns, maybe the title and header again, maybe a one-cell row on top.
    const p2: TextItem[] = [];
    let y2 = 800;
    const again = rnd(3);
    if (again === 1) {
      if (t1.table.title && titleKind === 2) {
        p2.push(item(t1.table.title, 50, y2));
        y2 -= pitch + 5;
      }
    }
    const extra: string[][] = [];
    if (cols[0]!.kind === "party" && rnd(2) === 0 && again !== 1) {
      const name = PARTIES[rnd(PARTIES.length)]!;
      p2.push(cellAt(cols[0]!, name, y2));
      extra.push([name, ...cols.slice(1).map(() => "")]);
      y2 -= pitch;
    }
    const t3 = buildTable(rnd, cols, y2, pitch, { rows: 1 + rnd(4), wraps: true, oneCell: true, header: again === 1, startSr: t1.table.rows.length + 1 });
    p2.push(...t3.items);
    t1.table.rows.push(...extra, ...t3.table.rows);
    pages.push({ items: p2 });
    labels.push(`continuation ${again}`);
  }
  return { pages, tables, label: labels.join(", ") };
}

describe("pdf reader, generated tables", () => {
  test("exact cells or a warning, never fused or silently missing", () => {
    let exact = 0;
    let warned = 0;
    for (let seed = 1; seed <= 600; seed++) {
      const c = generate(seed);
      const r = readPdfText(c.pages.map((p) => p.items));
      if (r.warnings.length > 0) {
        warned++;
        // Even with a warning, no cell may hold two generated values.
        const known = new Set(c.tables.flatMap((t) => [...t.headers, ...t.rows.flat()]));
        for (const b of r.blocks) for (const row of b.rows) for (const cell of row) if (cell !== "") expect(known.has(cell), `${c.label}: ${cell}`).toBe(true);
        continue;
      }
      const got = r.blocks.map((b) => ({ title: b.title, headers: b.headers, rows: b.rows }));
      expect(got, c.label).toEqual(c.tables);
      exact++;
    }
    expect(exact + warned).toBe(600);
    // Warnings are the honest way out, not the usual one.
    expect(warned).toBeLessThan(12);
  });
});
