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
    const row = { name: "Flux", unit: "kg", openingMilli: 1500, openingPaise: 12345, inMilli: 0, inPaise: 0, outMilli: 250, outPaise: 100, ratedPaise: 0, closingMilli: 1250, closingPaise: 12245, closingUnratedMilli: 0 };
    const totals = { openingPaise: 12345, inPaise: 0, outPaise: 100, ratedPaise: 0, closingPaise: 12245 };
    const csv = monthCsv(["h"], [row], totals, "Total", (u) => u);
    expect(csv).toBe("h\r\nFlux,kg,1.500,123.45,0.000,0.00,0.250,1.00,0.00,1.250,122.45,0.000\r\nTotal,,,123.45,,0.00,,1.00,0.00,,122.45,\r\n");
  });
  test("a GRN cancelled from an earlier month writes its negative in and value as numbers, not text", () => {
    const row = { name: "-Flux", unit: "kg", openingMilli: 2000, openingPaise: 20000, inMilli: -500, inPaise: -5000, outMilli: 0, outPaise: 0, ratedPaise: 0, closingMilli: 1500, closingPaise: 15000, closingUnratedMilli: 0 };
    const totals = { openingPaise: 20000, inPaise: -5000, outPaise: 0, ratedPaise: 0, closingPaise: 15000 };
    const csv = monthCsv(["h"], [row], totals, "Total", (u) => u);
    // The item name that starts like a formula is still neutralised; the minus signs are not.
    expect(csv).toBe("h\r\n'-Flux,kg,2.000,200.00,-0.500,-50.00,0.000,0.00,0.00,1.500,150.00,0.000\r\nTotal,,,200.00,,-50.00,,0.00,0.00,,150.00,\r\n");
  });
  test("old stock rated and the quantity still without a rate get their own columns", () => {
    const row = { name: "Flux", unit: "kg", openingMilli: 1000, openingPaise: 0, inMilli: 0, inPaise: 0, outMilli: 0, outPaise: 0, ratedPaise: 8450, closingMilli: 1000, closingPaise: 8450, closingUnratedMilli: 400 };
    const totals = { openingPaise: 0, inPaise: 0, outPaise: 0, ratedPaise: 8450, closingPaise: 8450 };
    const csv = monthCsv(["h"], [row], totals, "Total", (u) => u);
    expect(csv).toBe("h\r\nFlux,kg,1.000,0.00,0.000,0.00,0.000,0.00,84.50,1.000,84.50,0.400\r\nTotal,,,0.00,,0.00,,0.00,84.50,,84.50,\r\n");
  });
});
