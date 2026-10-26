import { describe, expect, test } from "bun:test";

import {
  LOT_TONE,
  formatRate,
  lotListChip,
  lotNextStep,
  maxWeightDebitG,
  weightNotesOverShortG,
  type LotForSteps,
  type LotPerms,
} from "./lot-view";

const ALL: LotPerms = { receipt: true, dcnote: true, publish: true };
const YARD: LotPerms = { receipt: true, dcnote: false, publish: false };
const MANAGER: LotPerms = { receipt: false, dcnote: false, publish: true };

function lot(over: Partial<LotForSteps> = {}): LotForSteps {
  return {
    status: "unload",
    fcKgG: 12_430_000,
    shortBeyondTolerance: false,
    noteCoversShort: true,
    flag: null,
    notes: [],
    ...over,
  };
}

describe("LOT_TONE", () => {
  test("every lot status has a tone; OK is green and cancelled red", () => {
    expect(LOT_TONE).toEqual({ booking: "neutral", unload: "amber", ok: "green", cancelled: "red" });
  });
});

describe("lotNextStep", () => {
  test("a booked lot can be marked unloading and OK by the yard", () => {
    const s = lotNextStep(lot({ status: "booking" }), YARD);
    expect(s.primary).toBe("ok");
    expect(s.canUnload).toBe(true);
    expect(s.canCancel).toBe(true);
    expect(s.canEditWeights).toBe(true);
    expect(s.blocked).toBeNull();
  });

  test("unloading lot: OK is the primary step, no second unload", () => {
    const s = lotNextStep(lot(), YARD);
    expect(s.primary).toBe("ok");
    expect(s.canUnload).toBe(false);
  });

  test("not weighed on our kanta yet: weigh first", () => {
    const s = lotNextStep(lot({ fcKgG: null }), YARD);
    expect(s.primary).toBe("weigh");
    expect(s.blocked).toBe("weigh");
  });

  test("short beyond tolerance without a covering note: the office raises a debit note", () => {
    const short = lot({ shortBeyondTolerance: true, noteCoversShort: false, flag: "short_without_note" });
    expect(lotNextStep(short, ALL).shortWithoutNote).toBe(true);
    expect(lotNextStep(short, ALL).primary).toBe("note");
    expect(lotNextStep(short, ALL).blocked).toBe("short");
    // The yard cannot raise notes: nothing to press, and the screen says who can.
    expect(lotNextStep(short, YARD).primary).toBeNull();
    expect(lotNextStep(short, YARD).blocked).toBe("short");
  });

  test("a pending note that covers the short lets the lot go OK", () => {
    const covered = lot({
      shortBeyondTolerance: true,
      noteCoversShort: true,
      notes: [{ status: "pending", type: "debit", reason: "weight", boriDeductionG: 0 }],
    });
    const s = lotNextStep(covered, ALL);
    expect(s.primary).toBe("ok");
    expect(s.canRaiseNote).toBe(false);
  });

  test("weights lock while a weight note or a bori deduction is live", () => {
    expect(
      lotNextStep(lot({ notes: [{ status: "approved", type: "debit", reason: "weight", boriDeductionG: 0 }] }), ALL)
        .canEditWeights,
    ).toBe(false);
    expect(
      lotNextStep(lot({ notes: [{ status: "pending", type: "debit", reason: "grade", boriDeductionG: 4_000 }] }), ALL)
        .canEditWeights,
    ).toBe(false);
    expect(
      lotNextStep(lot({ notes: [{ status: "rejected", type: "debit", reason: "weight", boriDeductionG: 0 }] }), ALL)
        .canEditWeights,
    ).toBe(true);
  });

  test("an OK lot: only a manager may cancel it; nothing else to do", () => {
    const ok = lot({ status: "ok" });
    expect(lotNextStep(ok, YARD)).toMatchObject({ primary: null, canCancel: false, canEditWeights: false, canUnload: false });
    expect(lotNextStep(ok, MANAGER).canCancel).toBe(true);
    expect(lotNextStep(ok, ALL).canRaiseNote).toBe(true);
    expect(lotNextStep(ok, ALL).shortWithoutNote).toBe(false);
  });

  test("an OK lot whose covering note was rejected: the red message shows, and raising a note is the office's main step", () => {
    const rejected = lot({
      status: "ok",
      shortBeyondTolerance: true,
      noteCoversShort: false,
      flag: "short_without_note",
      notes: [{ status: "rejected", type: "debit", reason: "weight", boriDeductionG: 0 }],
    });
    expect(lotNextStep(rejected, ALL)).toMatchObject({ primary: "note", shortWithoutNote: true, blocked: null });
    // The yard and a manager see the message but have no note to raise.
    expect(lotNextStep(rejected, YARD)).toMatchObject({ primary: null, shortWithoutNote: true });
    expect(lotNextStep(rejected, MANAGER)).toMatchObject({ primary: null, shortWithoutNote: true, canCancel: true });
    // A second note already waiting: nothing more to raise until it is decided.
    const waiting = lot({ ...rejected, notes: [...rejected.notes, { status: "pending", type: "debit", reason: "grade", boriDeductionG: 0 }] });
    expect(lotNextStep(waiting, ALL)).toMatchObject({ primary: null, shortWithoutNote: true, canRaiseNote: false });
  });

  test("weights locked by a live weight note: said only to those who could otherwise edit them", () => {
    const locked = lot({ notes: [{ status: "pending", type: "debit", reason: "weight", boriDeductionG: 0 }] });
    expect(lotNextStep(locked, YARD)).toMatchObject({ canEditWeights: false, weightsLocked: true });
    expect(lotNextStep(locked, MANAGER).weightsLocked).toBe(false);
    expect(lotNextStep(lot(), YARD).weightsLocked).toBe(false);
    expect(lotNextStep(lot({ ...locked, status: "ok" }), YARD).weightsLocked).toBe(false);
  });

  test("a cancelled lot is frozen", () => {
    expect(lotNextStep(lot({ status: "cancelled", flag: "short_without_note" }), ALL)).toEqual({
      primary: null,
      blocked: null,
      shortWithoutNote: false,
      weightsLocked: false,
      canUnload: false,
      canCancel: false,
      canEditWeights: false,
      canRaiseNote: false,
    });
  });

  test("a manager without purchase.receipt sees no floor steps", () => {
    const s = lotNextStep(lot({ status: "booking" }), MANAGER);
    expect(s.primary).toBeNull();
    expect(s.canUnload).toBe(false);
    expect(s.canCancel).toBe(true);
  });
});

describe("lotListChip", () => {
  test("the list names the lot's real state from the server's flag, never by colouring the difference", () => {
    expect(lotListChip("booking", "short_without_note")).toBe("shortWithoutNote");
    expect(lotListChip("ok", "short_without_note")).toBe("shortWithoutNote");
    expect(lotListChip("unload", "note_pending")).toBe("notePending");
    expect(lotListChip("ok", null)).toBeNull();
    // Unknown flag (not loaded, or past the register's cap): no chip rather than a guess.
    expect(lotListChip("booking", undefined)).toBeNull();
    expect(lotListChip("cancelled", "short_without_note")).toBeNull();
  });
});

describe("weightNotesOverShortG", () => {
  test("kg the live weight notes debit beyond the whole short", () => {
    // DCN-5 in the review: 9,991 kg on a 200 kg short.
    expect(weightNotesOverShortG(200_000, 9_991_000)).toBe(9_791_000);
    expect(weightNotesOverShortG(200_000, 200_000)).toBe(0);
    expect(weightNotesOverShortG(200_000, 190_000)).toBe(0);
    // Ours heavier than party: any weight debit is over.
    expect(weightNotesOverShortG(-15_000, 5_000)).toBe(5_000);
    // Not weighed on our kanta: nothing to compare.
    expect(weightNotesOverShortG(null, 5_000)).toBe(0);
  });
});

describe("maxWeightDebitG", () => {
  test("a new weight debit may cover what the live weight notes leave of the short", () => {
    expect(maxWeightDebitG({ partyKgG: 3_000_000, fcKgG: 2_950_000 }, 0)).toBe(50_000);
    expect(maxWeightDebitG({ partyKgG: 3_000_000, fcKgG: 2_950_000 }, 30_000)).toBe(20_000);
    expect(maxWeightDebitG({ partyKgG: 3_000_000, fcKgG: 2_950_000 }, 60_000)).toBe(0);
    expect(maxWeightDebitG({ partyKgG: 3_000_000, fcKgG: 3_010_000 }, 0)).toBe(0);
    expect(maxWeightDebitG({ partyKgG: 3_000_000, fcKgG: null }, 0)).toBeNull();
  });
});

describe("formatRate", () => {
  test("paise per kg as rupees with two decimals, Indian grouping", () => {
    expect(formatRate(19_850)).toBe("₹198.50");
    expect(formatRate(1_234_500)).toBe("₹12,345.00");
  });
});
