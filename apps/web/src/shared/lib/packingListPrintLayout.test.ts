import { buildPackingListHtml } from "@orrn/documents/packing-list";
import { parsePackingListSnapshot } from "@orrn/documents/packing-list/model";
import { chromium } from "@playwright/test";
import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { labelled } from "../../../../../packages/documents/src/packing-list/fixtures";
import { buildPackingListPdfBlob } from "./packingListPdf";

function v2Snapshot() {
  return {
    version: 2,
    dispatch: { code: "DSP-000001", customer: { name: "Shivam" }, shipDate: null, notes: null, completedAt: null },
    company: { name: "Fourcubes" },
    items: [],
    generatedAt: "2026-10-03T06:30:00.000Z",
    header: {
      plNumber: "PL/2026-27/1",
      date: "2026-10-03",
      dispatchCode: "DSP-000001",
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
        rows: [
          { sr: 1, bundleNo: "26J4000", section: "12170", item: "Domal", weightG: 25_000, cutFt: 12, cutIn: 0, pcs: 10, kgPer12ftMilli: 2_500, range12ft: 2.5, po: null },
        ],
        subtotal: { bundles: 1, pcs: 10, weightG: 25_000 },
      },
    ],
    summary: { bundles: 1, pcs: 10, weightG: 25_000, text: "1 bundle · 25.00 kg" },
    issue: { revision: 1, dispatchCodes: ["DSP-000001"], branding: { show: false, tagline: null, logoUrl: null } },
  };
}

describe("packing list rendered column alignment", () => {
  test("v1 and v2 HTML total figures align with their headers within 2 px", async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      await page.setContent(buildPackingListHtml(parsePackingListSnapshot(labelled), "PL-0008"));
      const legacy = await page.evaluate(() => {
        const right = (element: Element) => element.getBoundingClientRect().right;
        const heads = [...document.querySelectorAll("th")];
        const total = [...document.querySelectorAll("tr.grand td")];
        return [
          { header: right(heads[3]!), total: right(total[3]!) },
          { header: right(heads[6]!), total: right(total[6]!) },
        ];
      });
      for (const position of legacy) expect(Math.abs(position.header - position.total)).toBeLessThanOrEqual(2);

      await page.setContent(buildPackingListHtml(parsePackingListSnapshot(v2Snapshot()), "PL/2026-27/1"));
      const v2 = await page.evaluate(() => {
        const right = (element: Element) => element.getBoundingClientRect().right;
        const heads = [...document.querySelectorAll("th")];
        return [...document.querySelectorAll("tr.sub")].flatMap((row) => {
          const cells = row.querySelectorAll("td");
          return [
            { header: right(heads[4]!), total: right(cells[1]!) },
            { header: right(heads[7]!), total: right(cells[4]!) },
          ];
        });
      });
      for (const position of v2) expect(Math.abs(position.header - position.total)).toBeLessThanOrEqual(2);
    } finally {
      await browser.close();
    }
  });

  test("v1 and v2 PDF total figures align with their headers within 2 px", async () => {
    const dir = mkdtempSync(join(tmpdir(), "k-plprint-layout-"));
    try {
      for (const fixture of [
        { pl: labelled, code: "PL-0008", weight: "152.97", pcs: "65" },
        { pl: v2Snapshot(), code: "PL/2026-27/1", weight: "25.00", pcs: "10" },
      ]) {
        const blob = await buildPackingListPdfBlob(parsePackingListSnapshot(fixture.pl), fixture.code);
        const path = join(dir, "list.pdf");
        writeFileSync(path, Buffer.from(await blob.arrayBuffer()));
        const xml = execFileSync("pdftotext", ["-bbox", path, "-"], { encoding: "utf8" });
        const words = [...xml.matchAll(/<word xMin="([\d.]+)" yMin="[\d.]+" xMax="([\d.]+)" yMax="[\d.]+">([^<]*)<\/word>/g)].map((match) => ({
          left: Number(match[1]),
          right: Number(match[2]),
          text: match[3],
        }));
        const header = words.findLast((word) => word.text === "kg")!;
        const weight = words.findLast((word) => word.text === fixture.weight)!;
        const pcsHead = words.find((word) => word.text === "Pcs")!;
        const pcs = words.findLast((word) => word.text === fixture.pcs)!;
        expect(Math.abs(header.right - weight.right)).toBeLessThanOrEqual(2);
        expect(Math.abs(pcsHead.right - pcs.right)).toBeLessThanOrEqual(2);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
