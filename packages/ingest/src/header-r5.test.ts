import { describe, expect, test } from "bun:test";

import { normalizeHeader } from "./fingerprint";
import { chooseHeader, type HeaderHoles } from "./header";
import { readSheet } from "./readers/blocks";
import { layoutOf } from "./readers/trust-helpers";

// PORTAL-RULES-3 section 5.1 and the reproductions of PORTAL-R4-CHECK.md.
const ORDER = layoutOf(["Party", "Order No", "PO", "Section", "Cut Length (mm)", "Pcs", "Kg", "Rate"], "orderbook");
const VENDOR = layoutOf(["Vendor", "GSTIN", "City", "Phone"], "vendors");
const COPY = layoutOf(["Series", "Section", "Copy", "Maker Die No", "Supplier", "Trial Kg/12ft", "Status"], "diecopies");
const ALL: HeaderHoles = { learned: [ORDER, VENDOR, COPY] };
const GUJ = layoutOf(["નામ", "શહેર", "ફોન"], "guj-party");
const d = (n: number, f: (i: number) => string[]) => Array.from({ length: n }, (_, i) => f(i));

function choose(m: (string | number)[][], holes: HeaderHoles = {}) {
  const read = readSheet(m);
  return read.blocks.map((b) => chooseHeader(b, holes));
}
const fitsAt = (m: (string | number)[][], holes: HeaderHoles = {}) => choose(m, holes).map((c) => (c.kind === "fits" ? `${c.headerRow}x${c.headerRows}` : "ask"));

describe("5.1: a key and value letterhead never fits (B1, A1, A7)", () => {
  test("A1", () => expect(fitsAt([["Customer:", "Mehta Metals", "Phone:", "9825012345"], ["Date", "Bill No", "Amount", "Balance"], ["01/04/2025", "101", "12500.00", "12500.00"], ["05/04/2025", "102", "8000.00", "20500.00"], ["09/04/2025", "103", "4000.00", "24500.00"]], ALL)).not.toContain("0x1"));
  test("A1b", () => expect(fitsAt([["Party Name:", "Shree Ganesh Alu", "GSTIN:", "24ABCDE1234F1Z5"], ["Section", "Pcs", "Kg", "Vehicle"], ["T4012", "120", "340.5", "GJ03AB1234"], ["T4013", "80", "210.0", "GJ03AB1234"]], ALL)).not.toContain("0x1"));
  test("A1c", () => expect(fitsAt([["Party", "Om Metals", "City", "Rajkot", "Mobile", "9825011111"], ["Date", "Challan", "Section", "Pcs", "Kg", "Rate"], ["01/04/2025", "11", "T4012", "120", "340.5", "245"], ["02/04/2025", "12", "T4013", "80", "210.0", "245"]], ALL)).not.toContain("0x1"));
  test("A1d: the true header is an exact learned fit", () => expect(fitsAt([["Party", "Om Metals", "City", "Rajkot"], ["Vendor", "GSTIN", "City", "Phone"], ["Hindalco", "24ABCDE1234F1Z5", "Silvassa", "9825000000"], ["Nalco", "21ABCDE1234F1Z5", "Angul", "9825000001"]], ALL)).toEqual(["1x1"]));
  test("A7: a near customer list under a letterhead asks, with its own row first", () => {
    const [c] = choose([["Party:", "FourCubes Aluminium", "City:", "Rajkot"], ["S.No", "Party", "Address", "City"], ...d(5, (i) => [String(i + 1), "Om " + i, "Plot " + i + " GIDC", "Rajkot"])]);
    expect(c!.kind).toBe("ask");
    if (c!.kind === "ask") expect(c!.candidates[0]!.headerRow).not.toBe(0);
  });
  test("A7b", () => expect(fitsAt([["Name:", "FourCubes Aluminium", "Phone:", "9825012345", "Email:", "info@fc.in"], ["Sr", "Party Name", "Address", "City", "Phone", "Since"], ...d(5, (i) => [String(i + 1), "Om " + i, "Plot " + i, "Rajkot", "98250" + i, "2019"])])).not.toContain("0x1"));
});

describe("5.1: names in every script (B2, A2)", () => {
  test("A2: a Gujarati list under a Gujarati letterhead fits at the header", () => expect(fitsAt([["શ્રી ગણેશ", "એલ્યુમિનિયમ", "રાજકોટ"], ["નામ", "શહેર", "ફોન"], ["ઓમ મેટલ્સ", "રાજકોટ", "9825011111"], ["મહેતા", "જામનગર", "9825022222"]], { learned: [GUJ] })).toEqual(["1x1"]));
  test("A2b: three Gujarati title cells over an English sheet never fit the Gujarati layout", () => {
    const cs = choose([["શ્રી", "ગણેશ", "ટ્રેડર્સ"], ["Section", "Pcs", "Kg"], ["T4012", "120", "340.5"], ["T4013", "80", "210"]], { learned: [GUJ] });
    for (const c of cs) {
      if (c.kind === "fits") expect([c.headerRow, c.fit.name]).toEqual([1, expect.not.stringMatching(/guj/)]);
      else expect(c.resembles?.name ?? "").not.toBe(GUJ.name);
    }
  });
  test("A2c: a Hindi header does not fit a Gujarati layout", () => expect(fitsAt([["पार्टी", "शहर", "फोन"], ["राम", "राजकोट", "98250"], ["श्याम", "जामनगर", "98251"]], { learned: [GUJ] })).toEqual(["ask"]));
  test("Hindi and Gujarati names normalise to names", () => {
    expect(normalizeHeader("નામ")).toBe("નામ");
    expect(normalizeHeader(" पार्टी  का नाम ")).toBe("पार्टी का नाम");
  });
});

describe("5.1: two-row headers only as an approved two-row layout (M2, A3)", () => {
  const units = [["Series", "Section", "Min", "Max", "Name"], ["", "", "kg/12ft", "kg/12ft", ""], ["T", "4012", "0.410", "0.450", "Angle"], ["T", "4013", "0.500", "0.540", "Channel"]];
  test("A3: a units row under a dies header asks, and names the layout it resembles", () => {
    const [c] = choose(units);
    expect(c!.kind).toBe("ask");
    if (c!.kind !== "ask") return;
    expect(c!.resembles).toMatchObject({ headerRow: 0, headerRows: 1, target: "dies" });
    expect(c!.candidates[0]).toEqual({ headerRow: 0, headerRows: 1 });
  });
  test("A3b: the approved two-row layout fits", () => {
    const two = layoutOf(["Series", "Section", "Min kg/12ft", "Max kg/12ft", "Name"], "dies-units", 2);
    expect(fitsAt(units, { learned: [two] })).toEqual(["0x2"]);
  });
  test("A3c: bundles with a units row asks", () => expect(fitsAt([["UID", "Series", "Section", "Qty", "Weight", "Length"], ["", "", "", "pcs", "kg", "mm"], ["B1", "T", "4012", "12", "34.5", "3660"], ["B2", "T", "4012", "12", "34.1", "3660"]])).toEqual(["ask"]));
});

describe("5.1: the top-most exact fit wins; a table below the guess's rows is asked about (M1, A4 to A6)", () => {
  test("A4", () => {
    const [c] = choose([["Date", "Press", "Hours", "Output kg"], ["01/04/2025", "P1", "8", "1200"], ["02/04/2025", "P1", "7.5", "1100"], ["Series", "Section", "Min weight (kg/12ft)", "Max weight (kg/12ft)"], ["T", "4012", "0.41", "0.45"], ["T", "4013", "0.50", "0.54"]]);
    expect(c!.kind).toBe("ask");
    if (c!.kind === "ask") expect(c!.candidates.map((x) => x.headerRow)).toEqual(expect.arrayContaining([0, 3]));
  });
  test("A4b", () => expect(fitsAt([["Party", "City", "Phone", "Since"], ["Om Metals", "Rajkot", "9825011111", "2019"], ["Mehta", "Jamnagar", "9825022222", "2020"], ["Name", "City"], ["Shree", "Morbi"], ["Ganesh", "Gondal"]])).toEqual(["ask"]));
  test("A5", () => expect(fitsAt([["Sr", "Die", "Kg/12ft", "Remarks"], ["Name", "City", "", ""], ["1", "T4012", "0.41", "ok"], ["2", "T4013", "0.5", "ok"]])).toEqual(["ask"]));
  test("A6", () => expect(fitsAt([["Bill", "Kg", "Amount"], ["101", "340", "83300"], ["102", "210", "51450"], ["Party", "Remarks", "134750"]])).toEqual(["ask"]));
  test("two exact rows: the top-most wins", () => {
    const rows = [["Name", "Phone", "City"], ["Om", "9825011111", "Rajkot"], ["Name", "Phone", "City"], ["Kamal", "9825011112", "Morbi"]];
    expect(chooseHeader({ preview: rows.map((cells, row) => ({ row, cells })), guess: { headerRow: 2 } })).toMatchObject({ kind: "fits", headerRow: 0 });
  });
});

describe("5.1: unnamed columns are part of a layout (M3)", () => {
  test("R12L: a blank Sr header fits its approved layout", () => {
    const SR = layoutOf(["", "Party Name", "City"], "party-sr");
    expect(fitsAt([["", "Party Name", "City"], ...d(4, (i) => [String(i + 1), "Om " + i, "Rajkot"])], { learned: [SR] })).toEqual(["0x1"]);
  });
  test("R8L: an unnamed remark column on the right fits its approved layout", () => {
    const RM = layoutOf(["Series", "Section", "Min (kg/12ft)", "Max (kg/12ft)", ""], "dies-rem");
    expect(fitsAt([["Series", "Section", "Min (kg/12ft)", "Max (kg/12ft)", ""], ...d(5, (i) => ["T", String(4000 + i), "0.41", "0.45", i % 2 ? "new" : "old"])], { learned: [RM] })).toEqual(["0x1"]);
  });
});

describe("5.1: a header beyond a long letterhead (M6, m7)", () => {
  test("m7: 13 key and value lines, then the header: the preview holds it and the answer is ask", () => {
    const lh = [["FourCubes Aluminium", "GIDC Rajkot"], ["Phone", "0281 2345678"], ["Email", "info at fc"], ["GSTIN", "24ABCDE1234F1Z5"], ["Bank", "SBI Rajkot"], ["IFSC", "SBIN0001"], ["Account", "Current"], ["Period", "Apr to Sep"], ["Prepared", "Office"], ["Checked", "Lalu"], ["Approved", "Owner"], ["Ref", "Order book"], ["Copy", "Office copy"]];
    const read = readSheet([...lh, ["Date", "Section", "Pcs", "Kg"], ["01/04/2025", "T4012", "12", "340"], ["02/04/2025", "T4013", "8", "210"]]);
    const b = read.blocks[0]!;
    const rows = b.preview.map((p) => p.row);
    expect(rows).toContain(13);
    expect(rows.slice(0, 3)).toEqual([0, 1, 2]);
    const c = chooseHeader(b);
    expect(c.kind).toBe("ask");
    if (c.kind === "ask") expect(c.candidates.map((x) => x.headerRow)).toContain(13);
  });
});
