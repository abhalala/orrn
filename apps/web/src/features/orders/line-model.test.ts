import { describe, expect, test } from "bun:test";

import { cutLengthMm, draftFromLine, lengthInputOf, lineProblems, newLine, parseKgG, parsePieces, quoteArgs, toLineEditInput, toLineInput, type LineDraft } from "./line-model";

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

describe("editing a booked line (review I-1)", () => {
  const stored = {
    lineId: "line-1",
    sectionId: "die-1",
    sectionCode: "14701",
    sectionName: "Patti",
    series: "PATTI",
    cutLengthMm: 5486,
    orderedPcs: 30,
    orderedG: 553_500,
    finish: "anodise" as string | null,
  };
  const detail = {
    dieInstanceId: null as string | null,
    tierRank: 1 as number | null,
    qtyBasis: "pcs" as string | null,
    weightBasis: "copy_current" as string | null,
    alloy: "6063",
    temper: "T6",
    ratePaise: 20150 as number | null | undefined,
  };

  test("the length goes back into the fields it was typed in", () => {
    expect(lengthInputOf(5486, "inch")).toEqual({ feet: "18", inches: "", mm: "" });
    expect(lengthInputOf(3810, "inch")).toEqual({ feet: "12", inches: "6", mm: "" });
    expect(lengthInputOf(3664, "inch")).toEqual({ feet: "12", inches: "0.25", mm: "" });
    expect(lengthInputOf(3658, "mm")).toEqual({ feet: "", inches: "", mm: "3658" });
  });

  test("a stored line becomes a draft with its id, copy choice, committed side and basis", () => {
    const d = draftFromLine("k1", stored, detail, "inch", true);
    expect(d).toMatchObject({
      id: "line-1",
      die: { id: "die-1", label: "14701 Patti" },
      copy: "tier:1",
      feet: "18",
      inches: "",
      basis: "pcs",
      pcsText: "30",
      kgText: "",
      weightBasis: "copy_current",
      alloy: "6063",
      temper: "T6",
      finish: "anodise",
      rate: "201.50",
    });
    expect(cutLengthMm(d, "inch")).toBe(5486);
    const kgLine = draftFromLine("k2", stored, { ...detail, qtyBasis: "kg", dieInstanceId: "c-9", tierRank: null, weightBasis: "band_start" }, "inch", false);
    expect(kgLine).toMatchObject({ copy: "copy:c-9", basis: "kg", kgText: "553.500", pcsText: "", weightBasis: "band_start", rate: "" });
    // A PL-8 line (no qtyBasis) is edited by kg unless it only has pieces.
    expect(draftFromLine("k3", stored, { ...detail, qtyBasis: null }, "inch", false).basis).toBe("kg");
  });

  test("the edit input carries the line id, only the typed side, and an explicit unpin", () => {
    const d = draftFromLine("k1", stored, detail, "inch", false);
    const input = toLineEditInput({ ...d, pcsText: "31" }, "inch", false);
    expect(input).toMatchObject({ id: "line-1", sectionId: "die-1", cutLengthMm: 5486, qtyBasis: "pcs", pcs: 31, dieInstanceId: null, tierRank: 1 });
    expect("kgG" in input).toBe(false);
    const fresh = toLineEditInput({ ...newLine("n"), die: { id: "die-2", label: "x" }, feet: "12", basis: "kg", kgText: "100" }, "inch", false);
    expect(fresh).toMatchObject({ sectionId: "die-2", kgG: 100_000, dieInstanceId: null, tierRank: null });
    expect("id" in fresh).toBe(false);
  });

  test("a booked line is quoted on its own locked basis (lineId)", () => {
    const d = draftFromLine("k1", stored, detail, "inch", false);
    expect(quoteArgs(d, "inch")).toMatchObject({ lineId: "line-1", pcs: 30 });
    expect(quoteArgs(base({ basis: "pcs", pcsText: "3" }), "inch")).not.toHaveProperty("lineId");
  });
});

describe("a PL-8 line left untouched", () => {
  test("is sent back with its stored figures and no committed side; touched, it takes the Wave 1 maths", () => {
    const stored = { lineId: "l", sectionId: "d", sectionCode: "1", sectionName: null, series: "S", cutLengthMm: 3658, orderedPcs: 40, orderedG: 100_000, finish: null };
    const detail = { dieInstanceId: null, tierRank: null, qtyBasis: null, weightBasis: null, alloy: null, temper: null };
    const d = draftFromLine("k", stored, detail, "inch", false);
    const same = toLineEditInput(d, "inch", false);
    expect(same).toMatchObject({ id: "l", kgG: 100_000, pcs: 40 });
    expect(same).not.toHaveProperty("qtyBasis");
    const touched = toLineEditInput({ ...d, kgText: "120" }, "inch", false);
    expect(touched).toMatchObject({ id: "l", qtyBasis: "kg", kgG: 120_000 });
  });
});
