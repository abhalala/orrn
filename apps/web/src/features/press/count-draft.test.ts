import { describe, expect, test } from "bun:test";

import { chooseDraft, initDraft, serverBase } from "./count-draft";
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
