import { describe, expect, test } from "bun:test";

import { chooseDraft, convertDraftUnit, draftForStorage, draftFromStorage, initDraft, serverBase } from "./count-draft";
import type { RunDetail } from "./types";

const detail = (over: Partial<{ discardG: number; pressRemark: string; rows: number }> = {}) =>
  ({
    run: {
      id: "r1",
      castId: "c1",
      pressedLengthMm: null,
      discardG: over.discardG ?? 0,
      endsG: 0,
      pressRemark: over.pressRemark ?? null,
      dieRemark: null,
      billetShortReason: null,
      trialResult: null,
    },
    billets: Array.from({ length: over.rows ?? 1 }, (_, i) => ({ lengthMm: 600, count: 4 + i, kgG: 77_000 })),
    lines: [],
    qc: [],
    planLines: [],
    copy: null,
  }) as unknown as RunDetail;

describe("the stored draft and the server's rows (review r1 m-6: the server wins once the run advanced)", () => {
  test("no stored draft starts from the server's rows", () => {
    const { draft, stale } = chooseDraft(null, detail(), "mm");
    expect(stale).toBe(false);
    expect(draft.castId).toBe("c1");
    expect(draft.billets[0]!.countText).toBe("4");
  });

  test("a draft started against the same saved rows is kept, with what was typed", () => {
    const data = detail();
    const mine = { ...initDraft(data, "mm"), step: 2, discardText: "6.5" };
    const { draft, stale } = chooseDraft(mine, data, "mm");
    expect(stale).toBe(false);
    expect(draft.discardText).toBe("6.5");
    expect(draft.step).toBe(2);
  });

  test("when another device saved rows meanwhile, the server's rows win and the screen says so", () => {
    const mine = { ...initDraft(detail(), "mm"), step: 3, discardText: "99" };
    const { draft, stale } = chooseDraft(mine, detail({ discardG: 6500, rows: 2 }), "mm");
    expect(stale).toBe(true);
    expect(draft.discardText).toBe("6.5");
    expect(draft.billets).toHaveLength(2);
    // The person stays on the step they were on.
    expect(draft.step).toBe(3);
  });

  test("a draft from before this check (no base) counts as stale", () => {
    const old = { ...initDraft(detail(), "mm"), base: undefined } as never;
    expect(chooseDraft(old, detail(), "mm").stale).toBe(true);
  });

  test("the base changes with the saved rows and with the saved remark, not with a re-read", () => {
    expect(serverBase(detail())).toBe(serverBase(detail()));
    expect(serverBase(detail())).not.toBe(serverBase(detail({ discardG: 1 })));
    expect(serverBase(detail())).not.toBe(serverBase(detail({ pressRemark: "x" })));
  });
});

describe("a stored draft survives a change of the plant's length unit (units sweep 3, M2)", () => {
  // An mm plant's operator has typed: billet 600 mm, a cut of 3658 mm, pressed length 45000 mm.
  const typedInMm = () => {
    const d = initDraft(detail(), "mm");
    return {
      ...d,
      billets: d.billets.map((b) => ({ ...b, lengthText: "600" })),
      lines: [{ key: "l1", cutLengthMm: null, cutText: "3658", pcsText: "10", kgText: "5", pressPlanLineId: null, orderNumber: null, releasedPcs: null }],
      pressedLengthText: "45000",
    };
  };

  test("what goes to storage holds whole mm, not text in the typing unit", () => {
    const stored = draftForStorage(typedInMm(), "mm");
    expect(stored.v).toBe(2);
    expect(stored.pressedLengthMm).toBe(45_000);
    expect(stored.billets[0]).toMatchObject({ lengthMm: 600 });
    expect(stored.lines[0]).toMatchObject({ typedCutMm: 3_658 });
    expect(JSON.stringify(stored)).not.toContain("pressedLengthText");
    expect(JSON.stringify(stored)).not.toContain("lengthText");
  });

  test("the same draft is read in mm on an mm plant, exactly as typed", () => {
    const back = draftFromStorage(JSON.parse(JSON.stringify(draftForStorage(typedInMm(), "mm"))), "mm")!;
    expect(back.pressedLengthText).toBe("45000");
    expect(back.lines[0]!.cutText).toBe("3658");
    expect(back.billets[0]!.lengthText).toBe("600");
  });

  test("an mm draft read after the plant chose feet and inches is the same length in inches, never 45000 inches", () => {
    const back = draftFromStorage(JSON.parse(JSON.stringify(draftForStorage(typedInMm(), "mm"))), "inch")!;
    expect(back.pressedLengthText).toBe("1771.65");
    expect(back.lines[0]!.cutText).toBe("144.02");
    expect(back.billets[0]!.lengthText).toBe("23.62");
  });

  test("an inch draft read after the plant went back to mm is the same length in mm, never 144 mm", () => {
    const inches = { ...typedInMm(), pressedLengthText: "1771.65", lines: [{ ...typedInMm().lines[0]!, cutText: "144" }] };
    const back = draftFromStorage(JSON.parse(JSON.stringify(draftForStorage(inches, "inch"))), "mm")!;
    expect(back.lines[0]!.cutText).toBe("3658");
    expect(back.pressedLengthText).toBe("45000");
  });

  test("a blank length stays blank and the other fields come back untouched", () => {
    const d = { ...typedInMm(), discardText: "6.5", step: 2, pressedLengthText: "" };
    const back = draftFromStorage(JSON.parse(JSON.stringify(draftForStorage(d, "mm"))), "inch")!;
    expect(back.pressedLengthText).toBe("");
    expect(back.discardText).toBe("6.5");
    expect(back.step).toBe(2);
    expect(back.base).toBe(d.base);
  });

  test("a draft from before this shape is dropped, not misread", () => {
    const old = JSON.parse(JSON.stringify(typedInMm())); // text lengths, no v
    expect(draftFromStorage(old, "inch")).toBeNull();
    expect(draftFromStorage({ ...old, v: 1 }, "mm")).toBeNull();
    expect(draftFromStorage(null, "mm")).toBeNull();
    expect(draftFromStorage("{}", "mm")).toBeNull();
    expect(draftFromStorage({ v: 2, billets: [{ lengthMm: "600" }], lines: [], qc: [], pressedLengthMm: null }, "mm")).toBeNull();
    // With nothing stored the screen starts from the server's rows.
    expect(chooseDraft(draftFromStorage(old, "inch"), detail(), "inch").draft.billets[0]!.lengthText).toBe("23.62");
  });

  test("the draft in memory follows a unit change while the screen is open", () => {
    const inch = convertDraftUnit(typedInMm(), "mm", "inch");
    expect(inch.pressedLengthText).toBe("1771.65");
    expect(inch.lines[0]!.cutText).toBe("144.02");
    expect(convertDraftUnit(inch, "inch", "mm").lines[0]!.cutText).toBe("3658");
    const same = typedInMm();
    expect(convertDraftUnit(same, "mm", "mm")).toBe(same);
  });
});
