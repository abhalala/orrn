import { describe, expect, test } from "bun:test";

import type { AgeingReportRow } from "@orrn/server/lib/ageingContracts";

import { dayOf, groupRows, joinCsvPages } from "./report-model";

const base = { batchNumber: "AG-1", ovenCode: "OV-1", trolleyCode: "T-1", loadedPcs: 10, takenByPackPcs: 4, remainingPcs: 6, held: false, inAt: Date.UTC(2026, 9, 24, 20, 0) } as AgeingReportRow;

describe("ageing report model", () => {
  test("the day is the company's, not the machine's", () => {
    // 20:00 UTC on the 24th is 01:30 on the 25th in India.
    expect(dayOf(Date.UTC(2026, 9, 24, 20, 0), "Asia/Kolkata")).toBe("2026-10-25");
    expect(dayOf(Date.UTC(2026, 9, 24, 20, 0), "UTC")).toBe("2026-10-24");
    expect(dayOf(null, "UTC")).toBe("-");
  });

  test("totals by oven count batches once and add the lines", () => {
    const rows = [base, { ...base, loadedPcs: 5, takenByPackPcs: 5, remainingPcs: 0 }, { ...base, batchNumber: "AG-2", ovenCode: "OV-2", held: true }];
    const g = groupRows(rows, "oven", "UTC");
    expect(g).toEqual([
      { key: "OV-1", batches: 1, loadedPcs: 15, takenByPackPcs: 9, remainingPcs: 6, heldLines: 0, lines: 2 },
      { key: "OV-2", batches: 1, loadedPcs: 10, takenByPackPcs: 4, remainingPcs: 6, heldLines: 1, lines: 1 },
    ]);
  });

  test("totals by day sort by day", () => {
    const rows = [{ ...base, inAt: Date.UTC(2026, 9, 25, 5) }, base];
    expect(groupRows(rows, "day", "UTC").map((g) => g.key)).toEqual(["2026-10-24", "2026-10-25"]);
  });

  test("csv pages join into one file with one header", () => {
    const joined = joinCsvPages(["Batch,Oven\r\nAG-1,OV-1\r\n", "Batch,Oven\r\nAG-2,OV-1\r\n"]);
    expect(joined).toBe("Batch,Oven\r\nAG-1,OV-1\r\nAG-2,OV-1\r\n");
    expect(joinCsvPages([])).toBe("");
  });
});
