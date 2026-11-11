import { describe, expect, test } from "bun:test";

import { labelled, RECEIPT_UUID, unlabelled } from "./fixtures";
import { buildPackingListHtml } from "./html";
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

  test("labelled groups name their section", () => {
    const html = buildPackingListHtml(parsePackingListSnapshot(labelled), "PL-0008");
    expect(html).toContain("A: 14701 PATTI");
  });
});
