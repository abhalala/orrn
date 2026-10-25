import { describe, expect, test } from "bun:test";

import {
  addLine,
  completeLines,
  copyChoiceInput,
  cutLengthMm,
  lineComplete,
  lineProblems,
  newDraft,
  parseKgG,
  parsePieces,
  partyProblem,
  quoteArgs,
  removeLine,
  toCreateInput,
  toLineInput,
  updateLine,
  type BookingDraft,
  type LineDraft,
} from "../features/orders/booking-form";

const filled = (over: Partial<LineDraft> = {}): LineDraft => ({
  key: "l1",
  die: { id: "die-1", label: "14701 Patti 1" },
  copy: "any",
  feet: "",
  inches: "",
  mm: "5486",
  pcsText: "30",
  kgText: "",
  basis: "pcs",
  weightBasis: "copy_current",
  ...over,
});

const draft = (over: Partial<BookingDraft> = {}): BookingDraft => ({
  customer: { id: "cust-1", name: "KD Extrusion" },
  po: " 4521 ",
  lines: [filled()],
  at: 0,
  step: "review",
  ...over,
});

describe("one line at a time (spec E2 Native)", () => {
  test("a new draft starts on the party step with one empty line, by pieces", () => {
    const d = newDraft("l1");
    expect(d.step).toBe("party");
    expect(d.lines).toHaveLength(1);
    expect(d.lines[0]).toMatchObject({ die: null, copy: "any", basis: "pcs" });
  });

  test("the party step needs a customer; the PO may wait (it is needed to confirm, not to book)", () => {
    expect(partyProblem({ customer: null })).toBe("orders.form.errors.customer");
    expect(partyProblem({ customer: { id: "c", name: "A" } })).toBeNull();
  });

  test("adding a line moves to it; removing keeps at least one and keeps the position valid", () => {
    const d = addLine(draft({ step: "review" }), "l2");
    expect(d.lines).toHaveLength(2);
    expect(d.at).toBe(1);
    expect(d.step).toBe("line");
    expect(removeLine(d, 1).at).toBe(0);
    expect(removeLine(removeLine(d, 1), 0).lines).toHaveLength(1);
  });

  test("updating one line leaves the others alone", () => {
    const two = addLine(draft(), "l2");
    const next = updateLine(two, 1, { pcsText: "50" });
    expect(next.lines[0]!.pcsText).toBe("30");
    expect(next.lines[1]!.pcsText).toBe("50");
  });
});

describe("a line's fields", () => {
  test("pieces are whole numbers from 1; kg is read to the gram", () => {
    expect(parsePieces("30")).toBe(30);
    expect(parsePieces("1,200")).toBe(1200);
    expect(parsePieces("0")).toBeNull();
    expect(parsePieces("2.5")).toBeNull();
    expect(parsePieces("")).toBeNull();
    expect(parseKgG("553.5")).toBe(553_500);
    expect(parseKgG("8,000")).toBe(8_000_000);
    expect(parseKgG("0")).toBeNull();
    expect(parseKgG("abc")).toBeNull();
  });

  test("length follows the company unit: mm, or feet and inches", () => {
    expect(cutLengthMm(filled({ mm: "5486" }), "mm")).toBe(5486);
    expect(cutLengthMm(filled({ mm: "", feet: "18", inches: "" }), "inch")).toBe(5486);
    expect(cutLengthMm(filled({ mm: "", feet: "11", inches: "6" }), "inch")).toBe(3505);
    // A stray mm value is never read as inches (and the other way round).
    expect(cutLengthMm(filled({ mm: "5486", feet: "", inches: "" }), "inch")).toBeNull();
    expect(cutLengthMm(filled({ mm: "", feet: "12" }), "mm")).toBeNull();
  });

  test("copy choices: any, one copy, or tier N or better", () => {
    expect(copyChoiceInput("any")).toEqual({ dieInstanceId: null, tierRank: null });
    expect(copyChoiceInput("copy:abc")).toEqual({ dieInstanceId: "abc", tierRank: null });
    expect(copyChoiceInput("tier:2")).toEqual({ dieInstanceId: null, tierRank: 2 });
    expect(copyChoiceInput("tier:x")).toEqual({ dieInstanceId: null, tierRank: null });
  });

  test("problems are named per field", () => {
    expect(lineProblems(filled(), "mm")).toEqual({});
    expect(lineProblems(filled({ die: null, mm: "", pcsText: "" }), "mm")).toEqual({
      die: "orders.form.errors.die",
      length: "orders.form.errors.length",
      qty: "orders.form.errors.qty",
    });
    expect(lineProblems(filled({ basis: "kg", kgText: "" }), "mm").qty).toBe("orders.form.errors.qty");
    expect(lineComplete(filled(), "mm")).toBe(true);
    expect(lineComplete(filled({ pcsText: "0" }), "mm")).toBe(false);
  });
});

describe("what is sent (the server works out the other side)", () => {
  test("by pieces: only pieces go; 30 pcs of 18 ft", () => {
    expect(toLineInput(filled(), "mm")).toEqual({
      sectionId: "die-1",
      cutLengthMm: 5486,
      qtyBasis: "pcs",
      pcs: 30,
      weightBasis: "copy_current",
    });
  });

  test("by kg: only kg goes (8,000 kg), with the pinned copy", () => {
    expect(toLineInput(filled({ basis: "kg", kgText: "8000", pcsText: "999", copy: "copy:c1", mm: "3658" }), "mm")).toEqual({
      sectionId: "die-1",
      cutLengthMm: 3658,
      qtyBasis: "kg",
      kgG: 8_000_000,
      weightBasis: "copy_current",
      dieInstanceId: "c1",
    });
  });

  test("a tier is sent as tierRank, band start as the weight basis", () => {
    expect(toLineInput(filled({ copy: "tier:2", weightBasis: "band_start" }), "mm")).toMatchObject({ tierRank: 2, weightBasis: "band_start" });
  });

  test("an incomplete line cannot be turned into input", () => {
    expect(() => toLineInput(filled({ die: null }), "mm")).toThrow();
  });

  test("the quote input mirrors the typed side and the chosen copy", () => {
    expect(quoteArgs(filled(), "mm")).toEqual({ sectionId: "die-1", dieInstanceId: null, cutLengthMm: 5486, qtyBasis: "pcs", pcs: 30, weightBasis: "copy_current" });
    expect(quoteArgs(filled({ basis: "kg", kgText: "8000", copy: "copy:c1" }), "mm")).toMatchObject({ qtyBasis: "kg", kgG: 8_000_000, dieInstanceId: "c1" });
    expect(quoteArgs(filled({ pcsText: "" }), "mm")).toBeNull();
    expect(quoteArgs(filled({ die: null }), "mm")).toBeNull();
  });

  test("the create input trims the PO, carries the replay key and every line", () => {
    const two = addLine(draft(), "l2");
    const withSecond = updateLine(two, 1, { ...filled({ key: "l2", pcsText: "200", mm: "3658" }) });
    const input = toCreateInput(withSecond, "mm", "req-1");
    expect(input).toMatchObject({ customerId: "cust-1", poNumber: "4521", clientRequestId: "req-1" });
    expect(input!.lines).toHaveLength(2);
  });

  test("no PO is fine for a booking; no customer or an incomplete line is not", () => {
    expect(toCreateInput(draft({ po: "  " }), "mm", "r")).not.toHaveProperty("poNumber");
    expect(toCreateInput(draft({ customer: null }), "mm", "r")).toBeNull();
    expect(toCreateInput(draft({ lines: [filled({ pcsText: "" })] }), "mm", "r")).toBeNull();
    expect(completeLines(draft({ lines: [filled(), filled({ key: "x", pcsText: "" })] }), "mm")).toHaveLength(1);
  });
});
