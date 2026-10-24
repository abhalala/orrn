import { describe, expect, test } from "bun:test";

import { parseImport, type ImportKind } from "./parse";
import { readCsvText } from "./read-file";
import { columnGuide, problemsCsv, rowsCsv, sampleCsv } from "./templates";

const KINDS: ImportKind[] = ["bundles", "dies", "customers"];

describe("sample sheets", () => {
  for (const kind of KINDS) {
    for (const unit of ["mm", "inch"] as const) {
      test(`${kind} sample for a ${unit} company imports with no problems and no unused columns`, async () => {
        const sheet = await readCsvText(sampleCsv(kind, unit));
        const res = parseImport(kind, sheet.rows, { companyUnit: unit, firstDataRow: sheet.firstDataRow });
        expect(res.missingColumns).toEqual([]);
        expect(res.ignoredColumns).toEqual([]);
        expect(res.rejected).toEqual([]);
        expect(res.ok.length).toBeGreaterThan(0);
      });
    }
  }

  test("bundle sample lengths mean the same mm in both units", async () => {
    const lengths = async (unit: "mm" | "inch") => {
      const sheet = await readCsvText(sampleCsv("bundles", unit));
      return parseImport("bundles", sheet.rows, { companyUnit: unit }).ok.map((r) => r.lengthMm);
    };
    expect(await lengths("mm")).toEqual([3658, 3505]);
    expect(await lengths("inch")).toEqual([3658, 3505]);
  });

  test("every guide header maps to its own field", () => {
    for (const kind of KINDS) {
      const guide = columnGuide(kind, "mm");
      const row = Object.fromEntries(guide.map((c) => [c.header, ""]));
      const res = parseImport(kind, [row], { companyUnit: "mm" });
      // Columns are reported in sheet order, which here is guide order.
      expect(res.columns.map((c) => c.field)).toEqual(guide.map((c) => c.field));
    }
  });
});

describe("problem and unsaved downloads use the person's own rows", () => {
  const sheet = {
    firstDataRow: 2,
    rows: [
      { "Die series": "40", "Weight (kg)": "" },
      { "Die series": "41", "Weight (kg)": "1e3" },
      { "Die series": "42", "Weight (kg)": "5" },
    ],
  };

  test("problemsCsv: row number, original cells, the problem in words, sorted by row", () => {
    const csv = problemsCsv(
      sheet,
      [
        { row: 3, reason: "imports.reason.notNumber", column: "Weight (kg)" },
        { row: 2, reason: "imports.reason.blank", column: "Weight (kg)" },
      ],
      { row: "Row", problem: "Problem" },
      (r) => `${r.column}: ${r.reason}`,
    );
    expect(csv).toBe(
      "Row,Die series,Weight (kg),Problem\r\n2,40,,Weight (kg): imports.reason.blank\r\n3,41,1e3,Weight (kg): imports.reason.notNumber\r\n",
    );
  });

  test("rowsCsv returns the chosen rows unchanged", () => {
    expect(rowsCsv(sheet, [4])).toBe("Die series,Weight (kg)\r\n42,5\r\n");
  });
});
