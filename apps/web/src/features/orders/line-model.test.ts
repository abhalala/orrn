import { describe, expect, test } from "bun:test";

import { cutLengthMm, lineProblems, newLine, parseKgG, parsePieces, quoteArgs, toLineInput, type LineDraft } from "./line-model";

const base = (patch: Partial<LineDraft>): LineDraft => ({
  ...newLine("k"),
  die: { id: "die-1", label: "14701 Patti" },
  feet: "18",
  ...patch,
});

describe("line input", () => {
  test("feet and inches become whole mm; mm companies read mm", () => {
    expect(cutLengthMm({ feet: "18", inches: "", mm: "" }, "inch")).toBe(5486);
    expect(cutLengthMm({ feet: "12", inches: "6", mm: "" }, "inch")).toBe(3810);
    expect(cutLengthMm({ feet: "", inches: "", mm: "3658" }, "mm")).toBe(3658);
    expect(cutLengthMm({ feet: "", inches: "", mm: "" }, "inch")).toBeNull();
  });

  test("pieces are whole and positive; kg goes to grams", () => {
    expect(parsePieces("30")).toBe(30);
    expect(parsePieces("1,200")).toBe(1200);
    expect(parsePieces("0")).toBeNull();
    expect(parsePieces("2.5")).toBeNull();
    expect(parseKgG("553.5")).toBe(553_500);
    expect(parseKgG("")).toBeNull();
  });
});

describe("quoteArgs", () => {
  test("nothing to quote until die, length and one side are in", () => {
    expect(quoteArgs(base({}), "inch")).toBeNull();
    expect(quoteArgs(base({ basis: "pcs", pcsText: "" }), "inch")).toBeNull();
    expect(quoteArgs(base({ die: null, basis: "pcs", pcsText: "30" }), "inch")).toBeNull();
  });

  test("by pieces sends pcs only; by kg sends grams only", () => {
    expect(quoteArgs(base({ basis: "pcs", pcsText: "30", copy: "copy:c1" }), "inch")).toEqual({
      sectionId: "die-1",
      dieInstanceId: "c1",
      cutLengthMm: 5486,
      qtyBasis: "pcs",
      weightBasis: "copy_current",
      pcs: 30,
    });
    expect(quoteArgs(base({ basis: "kg", kgText: "8000", copy: "tier:1" }), "inch")).toEqual({
      sectionId: "die-1",
      dieInstanceId: null,
      cutLengthMm: 5486,
      qtyBasis: "kg",
      weightBasis: "copy_current",
      kgG: 8_000_000,
    });
  });
});

describe("lineProblems", () => {
  test("a blank line names what is missing", () => {
    expect(lineProblems(newLine("k"), "inch")).toEqual({
      die: "orders.form.errors.die",
      length: "orders.form.errors.length",
      qty: "orders.form.errors.qty",
    });
    expect(lineProblems(base({ basis: "pcs", pcsText: "30" }), "inch")).toEqual({});
  });
});

describe("toLineInput", () => {
  test("only the typed side goes to the server; alloy and temper stay with the server unless edited", () => {
    const input = toLineInput(base({ basis: "pcs", pcsText: "30", copy: "tier:2", finish: "anodise" }), "inch", false);
    expect(input).toEqual({
      sectionId: "die-1",
      cutLengthMm: 5486,
      qtyBasis: "pcs",
      pcs: 30,
      weightBasis: "copy_current",
      tierRank: 2,
      finish: "anodise",
    });
  });

  test("an edited alloy wins; a rate is sent only when rates are on", () => {
    const d = base({ basis: "kg", kgText: "100", alloy: " 6061 ", rate: "201.5" });
    expect(toLineInput(d, "inch", true)).toMatchObject({ alloy: "6061", ratePaise: 20_150, kgG: 100_000 });
    expect(toLineInput(d, "inch", false)).not.toHaveProperty("ratePaise");
  });
});
