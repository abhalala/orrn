import { parsePackingListSnapshot } from "@orrn/documents/packing-list/model";
import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";

import { buildPackingListPdfBlob } from "./packingListPdf";

function snapshot(rowCount: number) {
  const rows = Array.from({ length: rowCount }, (_, i) => ({
    sr: i + 1,
    bundleNo: `26J${4000 + i}`,
    section: "12170",
    item: "Domal",
    weightG: 25_000,
    cutFt: 12,
    cutIn: 0,
    pcs: 10,
    kgPer12ftMilli: 2_500,
    range12ft: 2.5,
    po: null,
  }));
  return {
    version: 2,
    dispatch: { code: "DSP-000090", customer: { name: "Shivam" }, shipDate: null, notes: null, completedAt: null },
    company: { name: "Fourcubes" },
    items: [],
    generatedAt: "2026-10-03T06:30:00.000Z",
    header: {
      plNumber: "PL/2026-27/90",
      date: "2026-10-03",
      dispatchCode: "DSP-000090",
      company: { name: "Fourcubes", legalName: "Fourcubes Aluminium Pvt Ltd", gstin: null, address: null, phone: null },
      billTo: { name: "Shivam", gstin: null, address: null },
      shipTo: { name: "Shivam", gstin: null, address: null },
      vehicleNo: null,
      driverName: null,
      driverPhone: null,
      transporter: null,
      poNumbers: [],
      invoiceNumber: null,
      invoiceDate: null,
    },
    columns: ["sr", "bundleNo", "section", "item", "weightKg", "cutFt", "cutIn", "pcs", "kgPer12ft", "range12ft", "po"],
    groups: [
      {
        key: "line-1",
        salesOrderLineId: "line-1",
        orderNumber: "SO-4",
        orderPeriod: "2026-27",
        lineNo: 1,
        sectionCode: "12170",
        item: "Domal",
        finish: null,
        poNumber: null,
        rows,
        subtotal: { bundles: rowCount, pcs: rowCount * 10, weightG: rowCount * 25_000 },
      },
    ],
    summary: { bundles: rowCount, pcs: rowCount * 10, weightG: rowCount * 25_000, text: `${rowCount} bundles · 2,250.00 kg` },
    issue: { revision: 3, dispatchCodes: ["DSP-000090"], branding: { show: false, tagline: null, logoUrl: null } },
  };
}

function pdfTextStreams(bytes: ArrayBuffer): string[] {
  const source = Buffer.from(bytes).toString("latin1");
  const streams: string[] = [];
  for (const match of source.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    const raw = match[1]!;
    let text = raw;
    try {
      text = inflateSync(Buffer.from(raw, "latin1")).toString("latin1");
    } catch {
      // Page text may be stored without compression.
    }
    if (text.includes("BT")) {
      const decoded = text.replace(/\[([^\]]*)\]\s*TJ/g, (_, run: string) =>
        [...run.matchAll(/<([0-9A-Fa-f]+)>/g)].map((part) => Buffer.from(part[1]!, "hex").toString("latin1")).join(""),
      );
      streams.push([...decoded.matchAll(/BT[\s\S]*?Tf\s*\n([\s\S]*?)\nET/g)].map((run) => run[1]).join(""));
    }
  }
  return streams;
}

describe("packing list PDF print polish", () => {
  test("a long list keeps all signature labels on the last page and the footer on every page", async () => {
    const pl = parsePackingListSnapshot(snapshot(90));
    const blob = await buildPackingListPdfBlob(pl, "PL/2026-27/90");
    const streams = pdfTextStreams(await blob.arrayBuffer());
    const pages = streams.filter((text) => text.includes("Not a tax invoice."));

    expect(pages.length).toBeGreaterThan(1);
    const numbers = pages.map((page) => page.match(/Page (\d+) of (\d+)/));
    const total = Number(numbers[0]?.[2]);
    expect(total).toBe(pages.length);
    expect(numbers.map((match) => Number(match?.[1])).sort((a, b) => a - b)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    for (const page of pages) {
      expect(page).toContain("Not a tax invoice. Generated from the locked snapshot of PL/2026-27/90 rev 3.");
    }
    const labels = ["Packed by", "Checked by", "Driver received"];
    const signed = pages.filter((page) => labels.every((label) => page.includes(label)));
    expect(signed).toHaveLength(1);
    expect(signed[0]).toContain(`Page ${total} of ${total}`);
  });
});
