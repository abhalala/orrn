import { describe, expect, test } from "bun:test";

import {
  EMPTY_DRAFT,
  draftToCreateInput,
  draftToNoteInput,
  noteKgText,
  patchDraft,
  stepErrors,
  type LotDraft,
} from "./lot-draft";

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

  test("an inline debit note must cover the short beyond tolerance, stay within the short and keep bori under our weight", () => {
    // 6,540 vs 6,320 at 0.5 %: at least 187.3 kg, at most the 220 kg short.
    const withNote = (kg: string, bori = "") => draft({ raiseNote: true, noteKgText: kg, noteKgEdited: true, boriText: bori });
    const office = { toleranceBp: 50, canNote: true };
    expect(stepErrors(withNote("100"), "weights", office).noteKg).toBe("purchase.errors.noteTooSmall");
    expect(stepErrors(withNote("187.3"), "weights", office)).toEqual({});
    expect(stepErrors(withNote("220"), "weights", office)).toEqual({});
    expect(stepErrors(withNote("220.5"), "weights", office).noteKg).toBe("purchase.errors.noteOverShort");
    expect(stepErrors(withNote("7000"), "weights", office).noteKg).toBe("purchase.errors.noteOverShort");
    expect(stepErrors(withNote("220", "6320"), "weights", office).bori).toBe("purchase.errors.bori");
  });

  test("an inline note is ignored when the lot is not short beyond tolerance", () => {
    expect(
      stepErrors(draft({ fcText: "6539", raiseNote: true, noteKgText: "", noteKgEdited: true }), "weights", { toleranceBp: 50, canNote: true }),
    ).toEqual({});
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
  test("only when asked, allowed and the lot is short beyond tolerance", () => {
    const office = { toleranceBp: 50, canNote: true };
    expect(draftToNoteInput(draft({ raiseNote: false }), "lot-1", office)).toBeNull();
    expect(draftToNoteInput(draft({ fcText: "6539", raiseNote: true }), "lot-1", office)).toBeNull();
    // A role without purchase.dcnote never sends one, whatever the draft says.
    expect(draftToNoteInput(draft({ raiseNote: true }), "lot-1", { toleranceBp: 50, canNote: false })).toBeNull();
    expect(draftToNoteInput(draft({ raiseNote: true, boriText: "12.5", noteText: " 25 bori " }), "lot-1", office)).toEqual({
      lotId: "lot-1",
      type: "debit",
      reason: "weight",
      kgDiffG: 220_000,
      boriDeductionG: 12_500,
      note: "25 bori",
    });
  });
});

/** Type `text` into a field one key at a time, the way NumberInput reports it (onValueChange per key). */
function typeKeys(d: LotDraft, field: "partyText" | "fcText" | "noteKgText", text: string): LotDraft {
  let next = d;
  let value = d[field];
  for (const ch of text) {
    value += ch;
    next = patchDraft(next, { [field]: value });
  }
  return next;
}

/** Delete the field's text one key at a time from the end. */
function backspace(d: LotDraft, field: "partyText" | "fcText" | "noteKgText", keys: number): LotDraft {
  let next = d;
  for (let i = 0; i < keys; i++) next = patchDraft(next, { [field]: next[field].slice(0, -1) });
  return next;
}

const BLANK_WEIGHTS: Partial<LotDraft> = { partyText: "", fcText: "" };
const OFFICE = { toleranceBp: 50, canNote: true };
const YARD = { toleranceBp: 50, canNote: false };

describe("inline note kg follows the weights until the person edits it", () => {
  for (const [party, ours, short] of [
    ["1000", "980", "20"],
    ["6540", "6320", "220"],
    ["10000", "9900", "100"],
    ["10000", "9800", "200"],
  ] as const) {
    test(`party ${party} then ours ${ours}, typed key by key: the note is the whole short, ${short} kg`, () => {
      let d = draft(BLANK_WEIGHTS);
      d = typeKeys(d, "partyText", party);
      d = typeKeys(d, "fcText", ours);
      expect(noteKgText(d, 50)).toBe(short);
      expect(stepErrors(d, "weights", OFFICE)).toEqual({});
      expect(draftToNoteInput(d, "lot-1", OFFICE)?.kgDiffG).toBe(Number(short) * 1000);
    });
  }

  test("ours typed before party: still the whole short", () => {
    let d = draft(BLANK_WEIGHTS);
    d = typeKeys(d, "fcText", "980");
    d = typeKeys(d, "partyText", "1000");
    expect(noteKgText(d, 50)).toBe("20");
    expect(draftToNoteInput(d, "lot-1", OFFICE)?.kgDiffG).toBe(20_000);
  });

  test("no note kg while the lot is not short beyond tolerance", () => {
    let d = draft(BLANK_WEIGHTS);
    d = typeKeys(d, "partyText", "1000");
    expect(noteKgText(d, 50)).toBe("");
    d = typeKeys(d, "fcText", "996");
    expect(noteKgText(d, 50)).toBe("");
  });

  test("an edited note keeps what was typed, even across the short; a weight change starts it again from the short", () => {
    let d = typeKeys(typeKeys(draft(BLANK_WEIGHTS), "partyText", "1000"), "fcText", "980");
    d = patchDraft(d, { noteKgText: "" });
    d = typeKeys(d, "noteKgText", "15");
    expect(noteKgText(d, 50)).toBe("15");
    expect(stepErrors(d, "weights", OFFICE)).toEqual({});
    // The kanta slip said 990, not 980: the note follows the new short.
    d = backspace(d, "fcText", 2);
    d = typeKeys(d, "fcText", "90");
    expect(noteKgText(d, 50)).toBe("10");
    expect(draftToNoteInput(d, "lot-1", OFFICE)?.kgDiffG).toBe(10_000);
  });

  test("a cleared note stays empty and is refused, not refilled", () => {
    let d = typeKeys(typeKeys(draft(BLANK_WEIGHTS), "partyText", "1000"), "fcText", "980");
    d = patchDraft(d, { noteKgText: "" });
    expect(noteKgText(d, 50)).toBe("");
    expect(stepErrors(d, "weights", OFFICE).noteKg).toBe("purchase.errors.noteTooSmall");
  });
});

describe("yard roles (no purchase.dcnote) never meet the note's checks", () => {
  test("a draft whose short grows after a correction reports nothing about the note and sends none", () => {
    let d = draft(BLANK_WEIGHTS);
    d = typeKeys(d, "partyText", "10000");
    d = typeKeys(d, "fcText", "9940");
    // Corrected at the kanta: 9940 -> 9000 (1,000 kg short, minimum 950).
    d = backspace(d, "fcText", 3);
    d = typeKeys(d, "fcText", "000");
    expect(d.fcText).toBe("9000");
    expect(stepErrors(d, "weights", YARD)).toEqual({});
    expect(draftToNoteInput(d, "lot-1", YARD)).toBeNull();
    // Even a stale typed note (as an earlier version could leave) is not checked for the yard.
    expect(stepErrors({ ...d, noteKgText: "60", noteKgEdited: true }, "weights", YARD)).toEqual({});
  });

  test("lowering party below a typed note is not a hidden error for the yard either", () => {
    let d = typeKeys(typeKeys(draft(BLANK_WEIGHTS), "partyText", "1000"), "fcText", "980");
    d = backspace(d, "partyText", 4);
    d = typeKeys(d, "partyText", "1100");
    expect(stepErrors(d, "weights", YARD)).toEqual({});
  });
});
