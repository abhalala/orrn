import { describe, expect, test } from "bun:test";

import { LOT_TONE, formatRate, lotNextStep, type LotForSteps, type LotPerms } from "./lot-view";

const ALL: LotPerms = { receipt: true, dcnote: true, publish: true };
const YARD: LotPerms = { receipt: true, dcnote: false, publish: false };
const MANAGER: LotPerms = { receipt: false, dcnote: false, publish: true };

function lot(over: Partial<LotForSteps> = {}): LotForSteps {
  return {
    status: "unload",
    fcKgG: 12_430_000,
    shortBeyondTolerance: false,
    noteCoversShort: true,
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
    const short = lot({ shortBeyondTolerance: true, noteCoversShort: false });
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
  });

  test("a cancelled lot is frozen", () => {
    expect(lotNextStep(lot({ status: "cancelled" }), ALL)).toEqual({
      primary: null,
      blocked: null,
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

describe("formatRate", () => {
  test("paise per kg as rupees with two decimals, Indian grouping", () => {
    expect(formatRate(19_850)).toBe("₹198.50");
    expect(formatRate(1_234_500)).toBe("₹12,345.00");
  });
});
