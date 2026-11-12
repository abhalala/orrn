/**
 * The chooseHeader property (PORTAL-RULES-3 section 4.1): over generated sheets with letterheads, titles, colon lines,
 * key and value lines, column-number rows, two-row headers, footers, stacked second tables and leading blank rows,
 * built against the built-in layouts and against headers no layout knows, `chooseHeader` never returns "fits" for a
 * row that is not a true header, whatever the reader guessed.
 */
import { describe, expect, test } from "bun:test";

import { chooseHeader, type HeaderPick } from "./header";

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const chance = (r: Rand, p: number) => r() < p;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

type Col = { names: string[]; value: (r: Rand) => string; required?: boolean };

const PARTIES = ["Om Metals", "Kamal Bros", "Shree Ganesh", "Jay Ambe Traders", "Patel Aluminium"];
const CITIES = ["Rajkot", "Morbi", "Jamnagar", "Ahmedabad"];
const dec = (r: Rand, lo: number, hi: number) => (lo + r() * (hi - lo)).toFixed(int(r, 1, 3));
const phone = (r: Rand) => `98${int(r, 10000000, 99999999)}`;
const date = (r: Rand) => `${String(int(r, 1, 28)).padStart(2, "0")}-${String(int(r, 1, 12)).padStart(2, "0")}-2025`;

const LAYOUTS: Record<string, Col[]> = {
  dies: [
    { names: ["Series", "Die series"], value: (r) => pick(r, ["40", "25", "60", "32"]), required: true },
    { names: ["Section code", "Section", "Die no"], value: (r) => String(int(r, 1000, 9999)), required: true },
    { names: ["Min weight (kg/12ft)", "Min wt (kg/12ft)"], value: (r) => dec(r, 0.5, 3), required: true },
    { names: ["Max weight (kg/12ft)", "Max wt (kg/12ft)"], value: (r) => dec(r, 3, 6), required: true },
    { names: ["Name", "Description"], value: (r) => pick(r, ["Frame", "Shutter", "Track", "Handle"]) },
    { names: ["Status"], value: (r) => pick(r, ["active", "archived"]) },
    { names: ["Remarks", "Notes"], value: (r) => pick(r, ["", "new", "worn", ""]) },
  ],
  customers: [
    { names: ["Name", "Customer", "Party name", "Customer name"], value: (r) => pick(r, PARTIES), required: true },
    { names: ["Phone", "Mobile"], value: phone },
    { names: ["City", "Town"], value: (r) => pick(r, CITIES) },
    { names: ["GSTIN", "GST No"], value: (r) => `24ABCDE${int(r, 1000, 9999)}F1Z5` },
    { names: ["Email"], value: (r) => `buyer${int(r, 1, 99)}@example.com` },
    { names: ["Remarks", "Notes"], value: (r) => pick(r, ["", "cash", "credit 30 days"]) },
  ],
  bundles: [
    { names: ["Legacy id", "Bundle id"], value: (r) => String(int(r, 10000, 99999)), required: true },
    { names: ["Die series", "Series"], value: (r) => pick(r, ["40", "25", "60"]), required: true },
    { names: ["Section code", "Section"], value: (r) => String(int(r, 1000, 9999)), required: true },
    { names: ["Pcs", "Qty", "Pieces"], value: (r) => String(int(r, 5, 80)), required: true },
    { names: ["Weight (kg)", "Net weight (kg)"], value: (r) => dec(r, 20, 400), required: true },
    { names: ["Length (mm)", "Length (ft)"], value: (r) => pick(r, ["3660", "4880", "12", "16"]), required: true },
    { names: ["PO no"], value: (r) => `PO-${int(r, 1, 300)}` },
  ],
  // Headers no layout knows: plant registers.
  stock: [
    { names: ["Item", "Profile"], value: (r) => `${pick(r, ["K", "T", "R"])} ${int(r, 1000, 4999)}`, required: true },
    { names: ["Opening"], value: (r) => String(int(r, 0, 900)), required: true },
    { names: ["Received", "Inward"], value: (r) => String(int(r, 0, 300)), required: true },
    { names: ["Issued", "Outward"], value: (r) => String(int(r, 0, 300)), required: true },
  ],
  register: [
    { names: ["Particulars", "Party"], value: (r) => pick(r, PARTIES), required: true },
    { names: ["15-04-2025", "Apr-25", "2024"], value: (r) => String(int(r, 1, 90)), required: true },
    { names: ["16-04-2025", "May-25", "2025"], value: (r) => String(int(r, 1, 90)), required: true },
    { names: ["3.6", "12", "Total"], value: (r) => String(int(r, 1, 900)), required: true },
  ],
};

type Gen = { rows: string[][]; truths: HeaderPick[]; layout: string; header: HeaderPick };

function table(r: Rand, layout: string, at: number): { rows: string[][]; header: HeaderPick; width: number } {
  const cols = LAYOUTS[layout]!.filter((c) => c.required || chance(r, 0.6));
  const names = cols.map((c) => pick(r, c.names));
  const rows: string[][] = [];
  let header: HeaderPick = { headerRow: at, headerRows: 1 };
  if (chance(r, 0.15) && cols.length >= 3) {
    // Two-row header: a group label over the last two columns.
    const top = names.map((n, i) => (i < names.length - 2 ? n : ""));
    top[names.length - 2] = pick(r, ["Apr 2025", "Weight", "Details"]);
    const bottom = names.map((n, i) => (i < names.length - 2 ? "" : n));
    rows.push(top, bottom);
    header = { headerRow: at, headerRows: 2 };
  } else rows.push(names);
  if (chance(r, 0.15)) rows.push(cols.map((_, i) => String(i + 1)));
  const n = int(r, 2, 8);
  for (let i = 0; i < n; i++) {
    if (chance(r, 0.05)) rows.push(cols.map(() => ""));
    rows.push(cols.map((c) => c.value(r)));
  }
  return { rows, header, width: cols.length };
}

function generate(seed: number): Gen {
  const r = rng(seed);
  const layout = pick(r, Object.keys(LAYOUTS));
  const rows: string[][] = [];
  const lead = chance(r, 0.2) ? int(r, 1, 3) : 0;
  for (let i = 0; i < lead; i++) rows.push([]);
  const width = 6;
  if (chance(r, 0.35)) {
    const wide = chance(r, 0.5) ? width : int(r, 2, 3);
    rows.push(["Fourcubes Extrusions", "Rajkot", "Gujarat", "India", "GSTIN 24ABCDE1234F1Z5", "Ph 0281"].slice(0, wide));
  }
  if (chance(r, 0.35)) rows.push([pick(r, ["Customer list", "Die list as on 01-04-2025", "Stock statement", "Bundle register 2025-26", "Name list"])]);
  if (chance(r, 0.2)) rows.push([`Party: ${pick(r, PARTIES)}`, `Date: ${date(r)}`]);
  if (chance(r, 0.2)) rows.push(["Name", pick(r, PARTIES)], ["Phone", phone(r)]);
  const t = table(r, layout, rows.length);
  rows.push(...t.rows);
  const truths = [t.header];
  if (chance(r, 0.25)) {
    if (chance(r, 0.5)) rows.push([]);
    const second = table(r, pick(r, Object.keys(LAYOUTS)), rows.length);
    rows.push(...second.rows);
    truths.push(second.header);
  }
  if (chance(r, 0.3)) rows.push(pick(r, [["Prepared by", "Checked by"], ["Rajkot", "", "", date(r)], ["Total", "", String(int(r, 100, 900))], ["Authorised Signatory"]]));
  return { rows: rows.slice(0, 12), truths, layout, header: t.header };
}

function guessFor(seed: number, g: Gen): HeaderPick {
  const r = rng(seed * 7 + 1);
  const filled = g.rows.map((row, i) => ({ row, i })).filter((x) => x.row.some((c) => c !== ""));
  if (chance(r, 0.4)) return g.header;
  const x = pick(r, filled);
  return { headerRow: x.i, headerRows: chance(r, 0.2) ? 2 : 1 };
}

describe("chooseHeader property", () => {
  test("never fits a row that is not a true header (3,000 generated sheets)", () => {
    let fits = 0;
    let knownFits = 0;
    let known = 0;
    const wrong: string[] = [];
    for (let seed = 1; seed <= 3000; seed++) {
      const g = generate(seed);
      const guess = guessFor(seed, g);
      const res = chooseHeader({ preview: g.rows.map((cells, row) => ({ row, cells })), guess });
      const isKnown = ["dies", "customers", "bundles"].includes(g.layout);
      if (isKnown) known++;
      if (res.kind !== "fits") continue;
      fits++;
      const ok = g.truths.some((t) => t.headerRow === res.headerRow && t.headerRows === res.headerRows);
      if (!ok) wrong.push(`seed ${seed}: picked ${res.headerRow}/${res.headerRows}, truth ${JSON.stringify(g.truths)}`);
      else if (isKnown && res.headerRow === g.header.headerRow) knownFits++;
    }
    if (process.env.HEADER_STATS) console.log({ fits, knownFits, known });
    expect(wrong.slice(0, 10)).toEqual([]);
    // The property is not empty: most sheets of a known layout find their header.
    expect(fits).toBeGreaterThan(800);
    expect(knownFits / known).toBeGreaterThan(0.6);
  }, 60_000);
});
