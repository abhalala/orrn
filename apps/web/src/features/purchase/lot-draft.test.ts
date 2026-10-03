import { describe, expect, test } from "bun:test";

import { EMPTY_DRAFT, draftToCreateInput, draftToNoteInput, stepErrors, type LotDraft } from "./lot-draft";

function draft(over: Partial<LotDraft> = {}): LotDraft {
  return {
    ...EMPTY_DRAFT,
    vendorId: "v-kd",
    itemId: "i-imp",
    grade: "A",
    rateText: "198.50",
    partyText: "6,540",
    fcText: "6320",
    date: "2026-10-03",
    ...over,
  };
}

describe("stepErrors", () => {
  test("vendor step needs a vendor", () => {
    expect(stepErrors(draft({ vendorId: null }), "vendor")).toEqual({ vendor: "purchase.errors.vendor" });
    expect(stepErrors(draft(), "vendor")).toEqual({});
  });

  test("material step needs an item, a grade and a sane rate", () => {
    expect(stepErrors(draft({ itemId: null, grade: null, rateText: "" }), "material")).toEqual({
      item: "purchase.errors.item",
      grade: "purchase.errors.grade",
      rate: "purchase.errors.rate",
    });
    expect(stepErrors(draft({ rateText: "0" }), "material").rate).toBe("purchase.errors.rate");
    expect(stepErrors(draft({ rateText: "10001" }), "material").rate).toBe("purchase.errors.rateHigh");
    expect(stepErrors(draft({ drossText: "101" }), "material").dross).toBe("purchase.errors.dross");
  });

  test("weights step: party kg required, ours optional, both under 100 t", () => {
    expect(stepErrors(draft({ partyText: "" }), "weights").party).toBe("purchase.errors.party");
    expect(stepErrors(draft({ fcText: "" }), "weights")).toEqual({});
    expect(stepErrors(draft({ fcText: "abc" }), "weights").fc).toBe("purchase.errors.fc");
    expect(stepErrors(draft({ partyText: "100001" }), "weights").party).toBe("purchase.errors.tooHeavy");
  });

  test("an inline debit note must cover the short beyond tolerance and keep bori under our weight", () => {
    // 6,540 vs 6,320 at 0.5 %: at least 187.3 kg.
    const withNote = (kg: string, bori = "") => draft({ raiseNote: true, noteKgText: kg, boriText: bori });
    expect(stepErrors(withNote("100"), "weights", { toleranceBp: 50 }).noteKg).toBe("purchase.errors.noteTooSmall");
    expect(stepErrors(withNote("187.3"), "weights", { toleranceBp: 50 })).toEqual({});
    expect(stepErrors(withNote("7000"), "weights", { toleranceBp: 50 }).noteKg).toBe("purchase.errors.noteTooBig");
    expect(stepErrors(withNote("220", "6320"), "weights", { toleranceBp: 50 }).bori).toBe("purchase.errors.bori");
  });

  test("an inline note is ignored when the lot is not short beyond tolerance", () => {
    expect(stepErrors(draft({ fcText: "6539", raiseNote: true, noteKgText: "" }), "weights", { toleranceBp: 50 })).toEqual({});
  });

  test("book step: vehicle and bill numbers have length limits", () => {
    expect(stepErrors(draft({ vehicleNo: "X".repeat(21) }), "book").vehicle).toBe("purchase.errors.vehicle");
    expect(stepErrors(draft({ date: "" }), "book").date).toBe("purchase.errors.date");
    expect(stepErrors(draft(), "book")).toEqual({});
  });
});

describe("draftToCreateInput", () => {
  test("converts kg and rupees to grams and paise; blanks become absent", () => {
    expect(draftToCreateInput(draft({ vehicleNo: " gj03ab4521 ", origin: "", drossText: "3.5" }))).toEqual({
      vendorId: "v-kd",
      itemId: "i-imp",
      grade: "A",
      ratePaise: 19_850,
      partyKgG: 6_540_000,
      fcKgG: 6_320_000,
      billBook: "main",
      date: "2026-10-03",
      drossBp: 350,
      vehicleNo: "GJ03AB4521",
    });
  });

  test("no FC weight yet: fcKgG is left out", () => {
    expect("fcKgG" in draftToCreateInput(draft({ fcText: "" }))).toBe(false);
  });
});

describe("draftToNoteInput", () => {
  test("only when asked and the lot is short beyond tolerance", () => {
    expect(draftToNoteInput(draft({ raiseNote: false }), "lot-1", 50)).toBeNull();
    expect(draftToNoteInput(draft({ fcText: "6539", raiseNote: true }), "lot-1", 50)).toBeNull();
    expect(draftToNoteInput(draft({ raiseNote: true, noteKgText: "220", boriText: "12.5", noteText: " 25 bori " }), "lot-1", 50)).toEqual({
      lotId: "lot-1",
      type: "debit",
      reason: "weight",
      kgDiffG: 220_000,
      boriDeductionG: 12_500,
      note: "25 bori",
    });
  });
});
