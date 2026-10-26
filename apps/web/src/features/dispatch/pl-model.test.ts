import { parsePackingListSnapshot } from "@orrn/documents/packing-list/model";
import { describe, expect, test } from "bun:test";

import { plViewOf } from "./pl-model";

const row = (sr: number, bundleNo: string, weightG: number, section = "12170") => ({
  sr,
  bundleNo,
  section,
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

function snapshot(over: Record<string, unknown> = {}) {
  return {
    version: 2,
    dispatch: { code: "DSP-000006", customer: { name: "Shivam" }, shipDate: "2026-10-04T00:00:00.000Z", notes: null, completedAt: null },
    company: { name: "FourCubes" },
    items: [],
    generatedAt: "2026-10-03T06:30:00.000Z",
    header: {
      plNumber: "PL/2026-27/7",
      date: "2026-10-03",
      dispatchCode: "DSP-000006",
      company: { name: "FourCubes", legalName: "Fourcubes Aluminium Pvt Ltd", gstin: "24AAAA", address: "Rajkot", phone: null },
      billTo: { name: "Shivam", gstin: null, address: null },
      shipTo: { name: "Shivam Yard", gstin: null, address: null },
      vehicleNo: "GJ05AB1234",
      driverName: "Ramesh",
      driverPhone: null,
      transporter: "Shree Logistics",
      poNumbers: ["PO-9"],
      invoiceNumber: "INV-9",
      invoiceDate: "2026-10-04",
      shipDate: "2026-10-04",
    },
    columns: ["sr", "bundleNo", "section", "item", "weightKg", "cutFt", "cutIn", "pcs", "kgPer12ft", "range12ft", "po"],
    groups: [
      group("l1", 1, "12170", [row(1, "26J4086", 25_000), row(2, "26J4087", 26_000)]),
      group("l2", 2, "12170", [row(3, "26J4088", 24_000)]),
      group("l3", 1, "14701", [row(4, "26J4090", 20_000, "14701")]),
    ],
    summary: { bundles: 4, pcs: 40, weightG: 95_000, text: "4 bundles · 95.000 kg" },
    issue: { revision: 2, dispatchCodes: ["DSP-000006"], branding: { show: false, tagline: "Extrusions" } },
    rowInfo: {
      "26J4086": { partyNo: "26J12", originalSo: "SO-4/1", profileKind: "hollow" },
      "26J4087": { partyNo: "26J13", originalSo: "SO-4/1", profileKind: "hollow" },
      "26J4088": { partyNo: "26J4088", originalSo: null, profileKind: "hollow" },
      "26J4090": { partyNo: "26J4090", originalSo: null, profileKind: "solid" },
    },
    sections: [
      { sectionCode: "12170", item: "Domal", bundles: 3, pcs: 30, weightG: 75_000 },
      { sectionCode: "14701", item: "Patti", bundles: 1, pcs: 10, weightG: 20_000 },
    ],
    profileSummary: [
      { kind: "hollow", bundles: 3, pcs: 30, weightG: 75_000 },
      { kind: "solid", bundles: 1, pcs: 10, weightG: 20_000 },
    ],
    print: { showBranding: false, showOriginalSo: true },
    ...over,
  };
}

const view = (over?: Record<string, unknown>) => plViewOf(parsePackingListSnapshot(snapshot(over)))!;

describe("packing list v2 view", () => {
  test("header: PL number and revision, vehicle, transporter, PO, invoice, ship date", () => {
    const v = view();
    expect(v).toMatchObject({
      plNumber: "PL/2026-27/7",
      revision: 2,
      vehicleNo: "GJ05AB1234",
      transporter: "Shree Logistics",
      poNumbers: ["PO-9"],
      invoiceNumber: "INV-9",
      shipDate: "04 Oct 2026",
      dispatchCodes: "DSP-000006",
    });
    expect(v.company.legalName).toBe("Fourcubes Aluminium Pvt Ltd");
  });

  test("branding off hides logo and tagline state, never the legal name", () => {
    const v = view();
    expect(v.branding).toEqual({ show: false, tagline: "Extrusions" });
    expect(v.company.legalName).toBeTruthy();
  });

  test("section subtotal only after the last group of a section that spans several groups", () => {
    const v = view();
    expect(v.groups.map((g) => g.sectionAfter?.sectionCode ?? null)).toEqual([null, "12170", null]);
    expect(v.groups[1]!.sectionAfter).toMatchObject({ bundles: 3, weightG: 75_000 });
  });

  test("the party number column shows when any party number differs; each row shows it only when it does", () => {
    const v = view();
    expect(v.columns.partyNo).toBe(true);
    expect(v.groups[0]!.rows.map((r) => r.partyNo)).toEqual(["26J12", "26J13"]);
    expect(v.groups[1]!.rows[0]!.partyNo).toBeNull();
  });

  test("the original order column: on by default, off when the revision hides it", () => {
    expect(view().columns.originalSo).toBe(true);
    expect(view().groups[0]!.rows[0]!.originalSo).toBe("SO-4/1");
    expect(view({ print: { showBranding: true, showOriginalSo: false } }).columns.originalSo).toBe(false);
  });

  test("hollow / solid / semi summary leaves zero kinds out and totals are the snapshot's", () => {
    const v = view();
    expect(v.profile.map((k) => k.kind)).toEqual(["hollow", "solid"]);
    expect(v.total).toEqual({ bundles: 4, pcs: 40, weightG: 95_000 });
    expect(v.summaryText).toBe("4 bundles · 95.000 kg");
  });

  test("a list stored before v2 has no v2 view (the old view reads it)", () => {
    const old = parsePackingListSnapshot({
      dispatch: { code: "D-1", customer: { name: "A" }, shipDate: null, notes: null, completedAt: null },
      company: { name: "X" },
      items: [],
      generatedAt: "2026-10-03T06:30:00.000Z",
    });
    expect(plViewOf(old)).toBeNull();
  });
});
