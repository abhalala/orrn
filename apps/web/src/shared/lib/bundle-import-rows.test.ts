import { describe, expect, test } from "bun:test";

import { describeSkipped, normalizeRow, partitionRows } from "./bundle-import-rows";

const parseLength = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};
const base = { dieSeries: "A", dieSectionCode: "B", quantity: "5", weightG: "25000", lengthMm: "3000" };
const run = (rows: Record<string, unknown>[]) => partitionRows(rows.map((r) => normalizeRow(r, parseLength)));

describe("bundle import rows", () => {
  test("a valid row passes", () => {
    const { rows, skipped } = run([base]);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([]);
  });

  test("zero or blank weight/length/quantity rows are skipped, never coerced to 0", () => {
    const { rows, skipped } = run([
      base,
      { ...base, weightG: "0" },
      { ...base, weightG: "" },
      { ...base, lengthMm: "" },
      { ...base, lengthMm: "0" },
      { ...base, quantity: "" },
      { ...base, quantity: "0" },
      { ...base, weightG: "abc" },
      { ...base, dieSeries: "" },
    ]);
    expect(rows).toHaveLength(1);
    expect(skipped).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  test("decimal grams round to whole grams; a weight that rounds to 0 is skipped", () => {
    const { rows, skipped } = run([{ ...base, weightG: "25000.4" }, { ...base, weightG: "0.4" }]);
    expect(rows[0]!.weightG).toBe(25000);
    expect(skipped).toEqual([2]);
  });

  test("describeSkipped lists the first few row numbers and a count of the rest", () => {
    expect(describeSkipped([3])).toBe("Skipped data row 3.");
    expect(describeSkipped([1, 2, 3, 4, 5, 6, 7])).toBe("Skipped data rows 1, 2, 3, 4, 5 and 2 more.");
  });
});
