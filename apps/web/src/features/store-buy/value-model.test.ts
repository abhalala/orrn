import { describe, expect, test } from "bun:test";

import { csvCell, csvText, defaultMonth, monthChoices, monthCsv, monthParts, toleranceBpFromText, toleranceText } from "./value-model";

describe("months", () => {
  test("default is the last full month", () => {
    expect(defaultMonth(new Date(2026, 10, 22))).toBe("2026-10");
    expect(defaultMonth(new Date(2027, 0, 5))).toBe("2026-12");
  });
  test("choices run back across the year end", () => {
    expect(monthChoices(new Date(2026, 1, 10), 4)).toEqual(["2026-01", "2025-12", "2025-11", "2025-10"]);
  });
  test("parts", () => {
    expect(monthParts("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(monthParts("2026-13")).toBeNull();
  });
});

describe("allowance percent", () => {
  test("0 to 50 in basis points", () => {
    expect(toleranceBpFromText("0")).toBe(0);
    expect(toleranceBpFromText("5")).toBe(500);
    expect(toleranceBpFromText(" 2.5 ")).toBe(250);
    expect(toleranceBpFromText("50")).toBe(5000);
  });
  test("refuses empty, words, negative and over 50", () => {
    for (const bad of ["", "abc", "-1", "50.01", "51", "100"]) expect(toleranceBpFromText(bad)).toBeNull();
  });
  test("text round trip", () => {
    expect(toleranceText(500)).toBe("5");
    expect(toleranceText(250)).toBe("2.5");
  });
});

describe("csv", () => {
  test("quotes and neutralises", () => {
    expect(csvCell('A, "B"')).toBe('"A, ""B"""');
    expect(csvCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvCell(5)).toBe("5");
    expect(csvText([["a", "b"], [1, 2]])).toBe("a,b\r\n1,2\r\n");
  });
  test("month report in exact decimals with a total row", () => {
    const row = { name: "Flux", unit: "kg", openingMilli: 1500, openingPaise: 12345, inMilli: 0, inPaise: 0, outMilli: 250, outPaise: 100, closingMilli: 1250, closingPaise: 12245 };
    const csv = monthCsv(["h"], [row], { openingPaise: 12345, inPaise: 0, outPaise: 100, closingPaise: 12245 }, "Total", (u) => u);
    expect(csv).toBe("h\r\nFlux,kg,1.500,123.45,0.000,0.00,0.250,1.00,1.250,122.45\r\nTotal,,,123.45,,0.00,,1.00,,122.45\r\n");
  });
});
