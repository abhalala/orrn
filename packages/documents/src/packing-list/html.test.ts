import { describe, expect, test } from "bun:test";

import { labelled, RECEIPT_UUID, unlabelled } from "./fixtures";
import { buildPackingListHtml } from "./html";
import { plPdfFileName } from "./snapshot";
import { parsePackingListSnapshot } from "./types";

describe("packing list html (native print)", () => {
  test("shows the header, the plant columns and the totals line", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(unlabelled), "PL-0007");
    expect(html).toContain("Shivam Aluminium, Bhavnagar");
    expect(html).toContain("PL-0007");
    expect(html).toContain("<title>PL-0007_Shivam Aluminium, Bhavnagar</title>");
    expect(html).toContain("Weight range /12'");
    expect(html).toContain("3 bundles · 152.97 kg");
    expect(html).not.toContain(RECEIPT_UUID);
    expect(html.toLowerCase()).not.toContain("total len");
  });

  test("the footer and page counter use page margin boxes, never a fixed footer", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(unlabelled), "PL-0007");
    expect(html).toContain("Fourcubes Extrusion · Not a tax invoice. Printed from PL-0007 revision 1 as issued.");
    expect(html).not.toContain("position: fixed");
    expect(html).toContain("@page");
    expect(html).toContain("@bottom-left");
    expect(html).toContain('@bottom-right { content: "Page " counter(page) " of " counter(pages);');
  });

  test("the grand total and signature labels share one unbreakable wrapper", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(unlabelled), "PL-0007");
    for (const label of ["Packed by", "Checked by", "Driver", "Receiver's signature"]) expect(html).toContain(label);
    expect(html).toContain(".closing { break-inside: avoid; page-break-inside: avoid; }");
    expect(html).toContain(".signature-line { height: 40px;");
    expect(html).toMatch(/<div class="closing">[\s\S]*<tr class="grand">[\s\S]*Packed by/);
  });

  test("PDF names remove invisible controls and cap at 200 UTF-8 bytes on whole graphemes", () => {
    expect(plPdfFileName("PL/2026-27/7", 'Shivam / Sons: "West" \\ Depot?')).toBe("PL-2026-27-7_Shivam-Sons-West-Depot.pdf");
    expect(plPdfFileName("***", "???")).toBe("packing-list_customer.pdf");
    expect(plPdfFileName("PL/7", "शिवाम एल्युमिनियम")).toBe("PL-7_शिवाम एल्युमिनियम.pdf");
    expect(plPdfFileName("PL/2026-27/90", "Acme\u202Efdp.exe\u200B")).toBe("PL-2026-27-90_Acmefdp.exe.pdf");
    expect(plPdfFileName("PL/7", "श्री\u200Dमान्")).toBe("PL-7_श्री\u200Dमान्.pdf");
    expect(plPdfFileName("PL/7", "शि\u200Cवम")).toBe("PL-7_शि\u200Cवम.pdf");

    const long = plPdfFileName("PL/7", "X".repeat(300));
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(200);
    expect(long.startsWith("PL-7_X")).toBe(true);
    expect(long.endsWith(".pdf")).toBe(true);

    const source = "श्रीमान् ".repeat(60);
    const hindi = plPdfFileName("PL/7", source);
    expect(new TextEncoder().encode(hindi).length).toBeLessThanOrEqual(200);
    expect(hindi.startsWith("PL-7_श्रीमान्")).toBe(true);
    const segmenter = new Intl.Segmenter("hi", { granularity: "grapheme" });
    const sourceParts = [...segmenter.segment(source)].map((part) => part.segment);
    const outputParts = [...segmenter.segment(hindi.slice("PL-7_".length, -4))].map((part) => part.segment);
    expect(outputParts.every((part, i) => part === (i === outputParts.length - 1 ? sourceParts[i]?.trimEnd() : sourceParts[i]))).toBe(true);
  });

  test("labelled groups name their section", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(labelled), "PL-0008");
    expect(html).toContain("A: 14701 PATTI");
  });
});
