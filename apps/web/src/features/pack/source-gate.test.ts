import { describe, expect, test } from "bun:test";

import { DEFAULT_SOURCE, castRequired, packableCopy, sourceBlockers, withCast, withCopy, withLine } from "./source-gate";

describe("source step gates", () => {
  test("cast is asked for when the setting says so, or once a melt exists and the setting is unset", () => {
    expect(castRequired({ requireCastOnBundle: true }, 0)).toBe(true);
    expect(castRequired({ requireCastOnBundle: false }, 3)).toBe(false);
    expect(castRequired({}, 0)).toBe(false);
    expect(castRequired({}, 2)).toBe(true);
  });

  test("a required cast blocks Next until one is picked", () => {
    expect(sourceBlockers({ choice: DEFAULT_SOURCE, castRequired: true, owner: { ok: true } })).toEqual([{ kind: "cast" }]);
    expect(sourceBlockers({ choice: withCast(DEFAULT_SOURCE, "c1"), castRequired: true, owner: { ok: true } })).toEqual([]);
  });

  test("an owned die: pick the copy, then the owner's order; plant stock never passes", () => {
    expect(sourceBlockers({ choice: DEFAULT_SOURCE, castRequired: false, owner: { ok: false, block: "pick_copy" } })).toEqual([{ kind: "copy" }]);
    expect(sourceBlockers({ choice: DEFAULT_SOURCE, castRequired: false, owner: { ok: false, block: "owned", ownerName: "KD Extrusion" } })).toEqual([
      { kind: "owned", ownerName: "KD Extrusion" },
    ]);
    expect(sourceBlockers({ choice: DEFAULT_SOURCE, castRequired: false, owner: { ok: false, block: "no_copies" } })).toEqual([
      { kind: "noCopies", ownerName: null },
    ]);
  });

  test("choosing and clearing keeps the other choices", () => {
    let c = withLine(DEFAULT_SOURCE, "l1");
    c = withCopy(c, "copy1");
    c = withCast(c, "cast1");
    expect(c).toEqual({ showLogo: true, salesOrderLineId: "l1", dieInstanceId: "copy1", castId: "cast1" });
    expect(withLine(c, undefined)).toEqual({ showLogo: true, dieInstanceId: "copy1", castId: "cast1" });
    expect(withCopy(c, undefined).dieInstanceId).toBeUndefined();
  });

  test("copies that are retired or at the maker are not offered", () => {
    expect(packableCopy("available")).toBe(true);
    expect(packableCopy("in_use")).toBe(true);
    expect(packableCopy("retired")).toBe(false);
    expect(packableCopy("at_maker")).toBe(false);
  });
});
