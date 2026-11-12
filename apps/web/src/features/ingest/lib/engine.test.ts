import { describe, expect, test } from "bun:test";
import Papa from "papaparse";
import * as XLSX from "xlsx";

import { engine } from "./engine";
import { readCsvText, readPdfBytes, readSheetBytes, readSqlChunks, type PdfLike, type ReadDeps, type XlsxLike } from "./reader-core";

/** The reader core on the real engine of @orrn/ingest, with small realistic files. */
const deps: ReadDeps = { engine, loadXlsx: async () => XLSX as unknown as XlsxLike, loadPapa: async () => Papa as never };

describe("real engine", () => {
  test("the die template CSV is one block with its ten headers", async () => {
    const csv = [
      "Series,Section code,Min weight (kg/12ft),Max weight (kg/12ft),Name,Width (mm),Thickness (mm),Leg (mm),Status,Notes",
      "40,4012,2.2,2.5,Window frame,44.5,1.2,,active,",
      "40,4013,1.1,1.4,Tee,30,1.5,,active,",
    ].join("\n");
    const blocks = await readCsvText(csv, deps);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.input.headers).toHaveLength(10);
    expect(blocks[0]!.input.rowCount).toBe(2);
    expect(blocks[0]!.input.headerRows).toBe(1);
  });

  test("a baki workbook with a title row and a total row", async () => {
    const wb = XLSX.utils.book_new();
    const rows = [
      ["PENDING ORDER LIST AS ON 31.10.2025"],
      ["Sr", "Party Name", "Order No", "Date", "Section", "Wt/12ft", "Ord Qty (Kg)", "Baki (Kg)", "Rate", "Remarks"],
      [1, "Shree Metals", "PO-1", new Date(Date.UTC(2025, 9, 1)), "R 2105", 2.4, 500, 120, 215, ""],
      [2, "Om Aluminium", "PO-2", new Date(Date.UTC(2025, 9, 3)), "R 2106", 1.8, 300, 300, 215, ""],
      ["", "TOTAL", "", "", "", "", 800, 420, "", ""],
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), "Baki");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx", cellDates: true }) as ArrayBuffer;
    const blocks = await readSheetBytes(buffer, deps);
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b.input.sheetName).toBe("Baki");
    expect(b.input.title).toContain("31.10.2025");
    expect(b.input.headerRow).toBe(1);
    expect(b.input.headers[1]).toBe("Party Name");
    expect(b.rows[0]![3]).toBe("2025-10-01");
    expect(b.input.dateColumns).toEqual([3]);
  });

  test("a SQL dump with INSERT rows, read in chunks", async () => {
    const dump =
      "CREATE TABLE die (id int, code text);\nINSERT INTO die (id, code) VALUES (1, 'R2105'), (2, 'R2106');\n";
    async function* chunks() {
      for (let i = 0; i < dump.length; i += 17) yield dump.slice(i, i + 17);
    }
    const blocks = await readSqlChunks(chunks(), dump.length, deps);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.input.sheetName).toBe("die");
    expect(blocks[0]!.input.headers).toEqual(["id", "code"]);
    expect(blocks[0]!.rows).toEqual([["1", "R2105"], ["2", "R2106"]]);
  });

  test("a text PDF becomes a table by line and column gaps", async () => {
    const at = (str: string, x: number, y: number) => ({ str, transform: [1, 0, 0, 1, x, y], width: str.length * 5, height: 10 });
    const pdf: PdfLike = {
      getDocument: () => ({
        promise: Promise.resolve({
          numPages: 1,
          getPage: async () => ({
            getTextContent: async () => ({
              items: [
                at("Section", 10, 700), at("Bundles", 150, 700), at("Weight", 260, 700),
                at("R2105", 10, 680), at("12", 150, 680), at("584", 260, 680),
                at("R2106", 10, 660), at("9", 150, 660), at("411", 260, 660),
              ],
            }),
          }),
        }),
      }),
    };
    const blocks = await readPdfBytes(new ArrayBuffer(8), { ...deps, loadPdf: async () => pdf });
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks[0]!.input.headers).toEqual(["Section", "Bundles", "Weight"]);
    expect(blocks[0]!.rows).toEqual([["R2105", "12", "584"], ["R2106", "9", "411"]]);
  });
});
