import { describe, expect, test } from "bun:test";
import * as XLSX from "xlsx";

import { buildPackingListHtml } from "./html";
import { plExtraColumns, plProfileLines, plRevisionText, plSectionSubtotalAfter } from "./snapshot";
import { parsePackingListSnapshot } from "./types";
import { buildPackingListXlsxBuffer } from "./xlsx";

/** A PL v2 snapshot with the FP-PK-13 blocks (two groups of one section, one of another). */
function v2(over: { issue?: unknown; print?: unknown; rowInfo?: unknown; strip?: boolean } = {}) {
  const row = (sr: number, bundleNo: string, weightG: number) => ({
    sr,
    bundleNo,
    section: "12170",
    item: "Domal",
    weightG,
    cutFt: 12,
    cutIn: 0,
    pcs: 10,
    kgPer12ftMilli: weightG / 10,
    range12ft: 2.5,
    po: null,
  });
  const group = (key: string, lineNo: number, sectionCode: string, rows: ReturnType<typeof row>[]) => ({
    key,
    salesOrderLineId: key,
    orderNumber: "SO-4",
    orderPeriod: "2026-27",
    lineNo,
    sectionCode,
    item: "Domal",
    finish: null,
    poNumber: null,
    rows,
    subtotal: { bundles: rows.length, pcs: rows.length * 10, weightG: rows.reduce((s, r) => s + r.weightG, 0) },
  });
  const base = {
    version: 2,
    dispatch: { code: "DSP-000006", customer: { name: "Shivam" }, shipDate: null, notes: null, completedAt: null },
    company: { name: "Fourcubes" },
    items: [],
    generatedAt: "2026-10-03T06:30:00.000Z",
    header: {
      plNumber: "PL/2026-27/7",
      date: "2026-10-03",
      dispatchCode: "DSP-000006",
      company: { name: "Fourcubes", legalName: "Fourcubes Aluminium Pvt Ltd", gstin: null, address: null, phone: null },
      billTo: { name: "Shivam", gstin: null, address: null },
      shipTo: { name: "Shivam", gstin: null, address: null },
      vehicleNo: null,
      driverName: null,
      driverPhone: null,
      transporter: "Shree Roadlines",
      poNumbers: [],
      invoiceNumber: null,
      invoiceDate: null,
    },
    columns: ["sr", "bundleNo", "section", "item", "weightKg", "cutFt", "cutIn", "pcs", "kgPer12ft", "range12ft", "po"],
    groups: [
      group("l1", 1, "12170", [row(1, "BG-1-B001", 25_000), row(2, "BG-1-B002", 26_000)]),
      group("l2", 2, "12170", [row(3, "BG-1-B003", 24_000)]),
      group("l3", 3, "12880", [row(4, "BG-2-B001", 10_000)]),
    ],
    summary: { bundles: 4, pcs: 40, weightG: 85_000, text: "4 bundles · 85.000 kg" },
  };
  if (over.strip) return base;
  return {
    ...base,
    issue: over.issue ?? { revision: 2, dispatchCodes: ["DSP-000006", "DSP-000007"], branding: { show: true, tagline: "Since 1994", logoUrl: "https://example.com/l.png" } },
    rowInfo: over.rowInfo ?? {
      "BG-1-B001": { partyNo: "26J9", originalSo: "SO-4/1", profileKind: "hollow" },
      "BG-1-B002": { partyNo: "26J10", originalSo: "SO-4/1", profileKind: "hollow" },
      "BG-1-B003": { partyNo: "26J11", originalSo: null, profileKind: "hollow" },
      "BG-2-B001": { partyNo: "26J12", originalSo: "SO-3/2", profileKind: "solid" },
    },
    sections: [
      { sectionCode: "12170", item: "Domal", bundles: 3, pcs: 30, weightG: 75_000 },
      { sectionCode: "12880", item: "Domal", bundles: 1, pcs: 10, weightG: 10_000 },
    ],
    profileSummary: [
      { kind: "hollow", bundles: 3, pcs: 30, weightG: 75_000 },
      { kind: "solid", bundles: 1, pcs: 10, weightG: 10_000 },
    ],
    print: over.print ?? { showBranding: true, showOriginalSo: true },
  };
}

describe("packing list v2 extras (FP-PK-13)", () => {
  test("party no and original SO columns, section subtotal, kinds, revision, combined dispatches", () => {
    const pl = parsePackingListSnapshot(v2());
    const html = buildPackingListHtml(pl, "PL/2026-27/7");
    for (const text of ["Party no", "Original SO", "26J10", "SO-3/2", "Section 12170", "Hollow 3 bundles · 75.000 kg", "Solid 1 bundle · 10.000 kg", "Rev 2", "DSP-000006, DSP-000007", "Since 1994", "https://example.com/l.png", "Fourcubes Aluminium Pvt Ltd"]) {
      expect(html).toContain(text);
    }
    // Only the section that spans two groups gets its own subtotal line.
    expect([...plSectionSubtotalAfter(pl as never).keys()]).toEqual([1]);
    expect(plRevisionText(pl as never)).toBe("Rev 2");
    expect(plProfileLines(pl as never)).toHaveLength(2);
  });

  test("branding off hides logo and tagline, never the legal name; original SO can be turned off", () => {
    const pl = parsePackingListSnapshot(
      v2({ issue: { revision: 1, dispatchCodes: ["DSP-000006"], branding: { show: false, tagline: null, logoUrl: null } }, print: { showBranding: false, showOriginalSo: false } }),
    );
    const html = buildPackingListHtml(pl, "PL/2026-27/7");
    expect(html).toContain("Fourcubes Aluminium Pvt Ltd");
    expect(html).not.toContain("Since 1994");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("Original SO");
    expect(html).not.toContain("Rev 1");
    expect(plExtraColumns(pl as never)).toEqual({ partyNo: true, originalSo: false });
  });

  test("a list stored before FP-PK-13 renders with the 11 columns only", () => {
    const pl = parsePackingListSnapshot(v2({ strip: true }));
    const html = buildPackingListHtml(pl, "PL/2026-27/7");
    expect(html).not.toContain("Party no");
    expect(html).not.toContain("Original SO");
    expect(plExtraColumns(pl as never)).toEqual({ partyNo: false, originalSo: false });
  });

  test("xlsx carries the extra columns, the section subtotal and the kinds", () => {
    const buffer = buildPackingListXlsxBuffer(parsePackingListSnapshot(v2()), "PL/2026-27/7");
    const wb = XLSX.read(buffer, { type: "array" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true });
    const header = grid.find((r) => r[0] === "Sr") as string[];
    expect(header.slice(-2)).toEqual(["Party no", "Original SO"]);
    const flat = grid.flat().map(String);
    expect(flat).toContain("Section 12170");
    expect(flat).toContain("Hollow 3 bundles · 75.000 kg");
    expect(flat).toContain("PL/2026-27/7 (Rev 2)");
    const first = grid.find((r) => r[1] === "BG-1-B001")!;
    expect(first.slice(-2)).toEqual(["26J9", "SO-4/1"]);
  });

  test("one kind prints its summary line in both the print and the xlsx (m-7: one behaviour)", () => {
    const pl = parsePackingListSnapshot({ ...v2(), profileSummary: [{ kind: "hollow", bundles: 3, pcs: 30, weightG: 75_000 }] });
    expect(buildPackingListHtml(pl, "PL/2026-27/7")).toContain("Hollow 3 bundles · 75.000 kg");
    const wb = XLSX.read(buildPackingListXlsxBuffer(pl, "PL/2026-27/7"), { type: "array" });
    const flat = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true }).flat().map(String);
    expect(flat).toContain("Hollow 3 bundles · 75.000 kg");
  });

  test("FP-PK-13: the kg-per-piece column is off by default, then follows the plant's switch in print and xlsx", () => {
    const pl = parsePackingListSnapshot(v2());
    // Off: no column, same 11 plus extras as before.
    expect(buildPackingListHtml(pl, "PL/2026-27/7")).not.toContain("kg/pc");
    const off = XLSX.read(buildPackingListXlsxBuffer(pl, "PL/2026-27/7"), { type: "array" });
    const offGrid = XLSX.utils.sheet_to_json<unknown[]>(off.Sheets[off.SheetNames[0]!]!, { header: 1, raw: true });
    expect((offGrid.find((r) => r[0] === "Sr") as string[]).includes("kg/pc")).toBe(false);

    // On: a last column; 25.000 kg over 10 pcs is 2.500 per piece, 26.000 is 2.600. Range/12' stays.
    const html = buildPackingListHtml(pl, "PL/2026-27/7", undefined, { kgPerPiece: true });
    expect(html).toContain("<th>kg/pc</th>");
    expect(html).toContain("2.500");
    expect(html).toContain("2.600");
    expect(html).toContain("Range /12&#39;".replace("&#39;", "'"));
    const on = XLSX.read(buildPackingListXlsxBuffer(pl, "PL/2026-27/7", undefined, { kgPerPiece: true }), { type: "array" });
    const grid = XLSX.utils.sheet_to_json<unknown[]>(on.Sheets[on.SheetNames[0]!]!, { header: 1, raw: true });
    const header = grid.find((r) => r[0] === "Sr") as string[];
    expect(header.at(-1)).toBe("kg/pc");
    expect(header).toContain("Range /12'");
    expect(grid.find((r) => r[1] === "BG-1-B001")!.at(-1)).toBe(2.5);
    expect(grid.find((r) => r[1] === "BG-1-B002")!.at(-1)).toBe(2.6);
  });
});

describe("kg/pc: one rounding rule (review m-6)", () => {
  test("grams per piece half up; the row model and the printed text agree at .0005", async () => {
    const { kgPerPieceG, plKgPerPiece } = await import("./snapshot");
    expect(kgPerPieceG(2_501, 2)).toBe(1_251); // 1.2505 kg -> 1.251
    expect(kgPerPieceG(2_499, 2)).toBe(1_250); // 1.2495 kg -> 1.250
    expect(kgPerPieceG(100, 0)).toBeNull();
    expect(plKgPerPiece({ weightG: 2_501, pcs: 2 })).toBe("1.251");
    expect(plKgPerPiece({ weightG: 1_000, pcs: 0 })).toBe("");
  });
});
