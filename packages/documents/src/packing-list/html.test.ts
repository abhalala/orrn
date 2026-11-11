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
    expect(html).toContain("Weight range /12'");
    expect(html).toContain("3 bundles · 152.97 kg");
    expect(html).not.toContain(RECEIPT_UUID);
    expect(html.toLowerCase()).not.toContain("total len");
  });

  test("the footer names the PL number and first revision", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(unlabelled), "PL-0007");
    expect(html).toContain("Not a tax invoice. Generated from the locked snapshot of PL-0007 rev 1.");
  });

  test("signature labels stay in one unbreakable block after the table", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(unlabelled), "PL-0007");
    for (const label of ["Packed by", "Checked by", "Driver received"]) expect(html).toContain(label);
    expect(html).toContain("break-inside: avoid");
    expect(html.indexOf("Packed by")).toBeGreaterThan(html.indexOf("</table>"));
  });

  test("PDF names use the PL number and customer, replace unsafe characters and stay bounded", () => {
    expect(plPdfFileName("PL/2026-27/7", 'Shivam / Sons: "West" \\ Depot?')).toBe("PL-2026-27-7_Shivam-Sons-West-Depot.pdf");
    expect(plPdfFileName("***", "???")).toBe("packing-list_customer.pdf");
    expect(plPdfFileName("PL/7", "शिवाम एल्युमिनियम")).toBe("PL-7_शिवाम एल्युमिनियम.pdf");
    const long = plPdfFileName(`PL/${"9".repeat(200)}`, "A".repeat(200));
    expect(Array.from(long).length).toBeLessThanOrEqual(160);
    expect(long.startsWith("PL-")).toBe(true);
    expect(long.endsWith(".pdf")).toBe(true);
  });

  test("labelled groups name their section", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(labelled), "PL-0008");
    expect(html).toContain("A: 14701 PATTI");
  });
});
