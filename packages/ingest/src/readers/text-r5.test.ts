import { describe, expect, test } from "bun:test";

import { readSheet, toCellText } from "./blocks";
import { detectDelimiter, readCsv } from "./csv";

// PORTAL-RULES-3 section 5.4: values pass through as text, and the CSV delimiter is chosen from the whole first lines.
describe("5.4: numbers are written without float noise", () => {
  test("toCellText", () => {
    expect(toCellText(12.299999999999999)).toBe("12.3");
    expect(toCellText(0.1 + 0.2)).toBe("0.3");
    expect(toCellText(0.18)).toBe("0.18");
    expect(toCellText(1234.5)).toBe("1234.5");
    expect(toCellText(-1234)).toBe("-1234");
    expect(toCellText(7)).toBe("7");
    expect(toCellText(-0)).toBe("0");
    expect(toCellText(123456789012345680)).toBe("123456789012345680");
    expect(toCellText(1 / 3)).toBe("0.333333333333333");
  });
  test("text cells are never coerced", () => {
    const [b] = readSheet([["Code", "Rate", "Pin"], ["007", "12.30", "000001"], ["18%", "(1,234)", "1,234.50"]]).blocks;
    expect(b!.rows).toEqual([["007", "12.30", "000001"], ["18%", "(1,234)", "1,234.50"]]);
  });
  test("a sheet of numbers reads as a person sees them, without noise", () => {
    const [b] = readSheet([["Party", "Kg"], ["Om", 12.299999999999999], ["Mehta", 0.1 + 0.2]]).blocks;
    expect(b!.rows).toEqual([["Om", "12.3"], ["Mehta", "0.3"]]);
  });
});

describe("5.4: the CSV delimiter (M7)", () => {
  test("a tab file with commas in names and grouped numbers is split on tabs", () => {
    const text = "Party\tCity\tKg\nOm, Metals\tRajkot, GJ\t1,200\nMehta, Co\tMorbi, GJ\t2,300\n";
    expect(detectDelimiter(text)).toBe("\t");
    const b = readCsv(text).blocks[0]!;
    expect(b.headers).toEqual(["Party", "City", "Kg"]);
    expect(b.rows).toEqual([["Om, Metals", "Rajkot, GJ", "1,200"], ["Mehta, Co", "Morbi, GJ", "2,300"]]);
  });
  test("semicolons with decimal commas", () => {
    expect(detectDelimiter("Party;Kg\nOm;1,5\nMehta;2,5\n")).toBe(";");
  });
  test("commas between digits are not counted", () => {
    expect(detectDelimiter("Party;Kg;Rate\nOm;1,200,000;12,5\nMehta;2,300;13,5\n")).toBe(";");
  });
  test("a plain comma file stays comma, quotes ignored", () => {
    expect(detectDelimiter('Party,Kg\n"Om; Metals",12\nMehta,13\n')).toBe(",");
  });
  test("a tie goes to tab, then semicolon", () => {
    expect(detectDelimiter("a\tb,c\n1\t2,3\n")).toBe("\t");
    expect(detectDelimiter("a;b,c\nx;y,z\n")).toBe(";");
  });
});
