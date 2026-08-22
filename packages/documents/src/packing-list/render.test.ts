import { expect, test } from "bun:test";
import * as XLSX from "xlsx";

import fixtureJson from "./fixtures/ambica-38.json";
import { buildPackingListHtml } from "./html";
import type { PLSnapshot } from "./snapshot";
import { buildPackingListXlsxBuffer } from "./xlsx";

const fixture = fixtureJson as PLSnapshot;

test("v2 HTML has grouped SI rows, NET and optional DRAFT", () => {
  const html = buildPackingListHtml({ ...fixture, dispatch: { ...fixture.dispatch, invoiceNo: "INV-12" } }, "PL-TEST");
  for (const label of ["8061 25X45 CLIP", "8045 29mm Track Rail", "8013 25mm Folding Profile", "8014 25mm Folding Clip", "BUNDLE", "NET"]) expect(html).toContain(label);
  for (const header of ["Cut Length", "Weight Kg / 12ft", "Weight Range"]) expect(html).not.toContain(header);
  expect(html).not.toContain('<div class="draft">DRAFT</div>');
  expect(html).toContain("INV-12");
  expect(buildPackingListHtml(fixture, "PL-TEST", "mm", { draft: true })).toContain('<div class="draft">DRAFT</div>');
});

test("v2 XLSX preserves Summary and groups Items", () => {
  const withInvoice = { ...fixture, dispatch: { ...fixture.dispatch, invoiceNo: "INV-12" } };
  const workbook = XLSX.read(buildPackingListXlsxBuffer(withInvoice, "PL-TEST"), { type: "array" });
  expect(workbook.SheetNames).toEqual(["Summary", "Items"]);
  expect(XLSX.utils.sheet_to_csv(workbook.Sheets.Summary!)).toContain("Inv No,INV-12");
  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets.Items!);
  expect(csv).toContain("8061 25X45 CLIP");
  expect(csv).toContain("NET");
});

test("v1 stays flat", () => {
  const v1 = { ...fixture, schemaVersion: undefined, groups: undefined } as PLSnapshot;
  const html = buildPackingListHtml(v1, "PL-V1");
  expect(html).not.toContain("UNGROUPED");
  expect(html).not.toContain(">NET<");
  expect(html).toContain("Inv No");
});
