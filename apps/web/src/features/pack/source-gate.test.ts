import { describe, expect, test } from "bun:test";

import {
  DEFAULT_SOURCE,
  castRequired,
  copyLocked,
  packableCopy,
  sourceBlockers,
  trolleyRequired,
  withAgeingRow,
  withCast,
  withCopy,
  withLine,
  withPinOverride,
  withPinnedLine,
} from "./source-gate";

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

describe("D15: a line that pins a die copy", () => {
  test("picking a pinned line preselects its copy; an unpinned line keeps the free choice", () => {
    const start = { showLogo: true, dieInstanceId: "copy-free" };
    expect(withPinnedLine(start, "line-1", "copy-pin")).toEqual({ showLogo: true, salesOrderLineId: "line-1", dieInstanceId: "copy-pin" });
    expect(withPinnedLine(start, "line-2", null)).toEqual({ showLogo: true, salesOrderLineId: "line-2", dieInstanceId: "copy-free" });
    // Plant stock (no line): the copy stays free, any override is dropped.
    expect(withPinnedLine({ ...start, overridePin: true }, undefined, null)).toEqual({ showLogo: true, dieInstanceId: "copy-free" });
  });

  test("the copy radios are locked to the pin unless the office overrides", () => {
    expect(copyLocked({ showLogo: true, salesOrderLineId: "l", dieInstanceId: "p" }, "p")).toBe(true);
    expect(copyLocked({ showLogo: true, salesOrderLineId: "l", dieInstanceId: "p", overridePin: true }, "p")).toBe(false);
    expect(copyLocked({ showLogo: true, salesOrderLineId: "l" }, null)).toBe(false);
  });

  test("turning the override off puts the pin back", () => {
    const c = { showLogo: true, salesOrderLineId: "l", dieInstanceId: "other", overridePin: true };
    expect(withPinOverride(c, false, "p")).toEqual({ showLogo: true, salesOrderLineId: "l", dieInstanceId: "p" });
    expect(withPinOverride({ showLogo: true, salesOrderLineId: "l", dieInstanceId: "p" }, true, "p")).toEqual({
      showLogo: true,
      salesOrderLineId: "l",
      dieInstanceId: "p",
      overridePin: true,
    });
  });
});

describe("W3-AG-W: the trolley line", () => {
  test("picking a line sets it, picking none takes it off and keeps the rest", () => {
    const c = { showLogo: true, salesOrderLineId: "l", castId: "c" };
    expect(withAgeingRow(c, "row-1")).toEqual({ ...c, ageingRowId: "row-1" });
    expect(withAgeingRow({ ...c, ageingRowId: "row-1" }, undefined)).toEqual(c);
  });

  test("a plant that packs from a trolley blocks Next until a line is picked, when one is waiting", () => {
    const base = { choice: { showLogo: true }, castRequired: false, owner: undefined };
    expect(sourceBlockers({ ...base, trolleyRequired: true })).toEqual([{ kind: "trolley" }]);
    expect(sourceBlockers({ ...base, choice: { showLogo: true, ageingRowId: "r" }, trolleyRequired: true })).toEqual([]);
    expect(sourceBlockers({ ...base, trolleyRequired: false })).toEqual([]);
  });

  test("the rule is the setting and at least one released line", () => {
    expect(trolleyRequired({ ageing: { requireForPack: true } }, 2)).toBe(true);
    expect(trolleyRequired({ ageing: { requireForPack: true } }, 0)).toBe(false);
    expect(trolleyRequired({ ageing: { requireForPack: false } }, 2)).toBe(false);
    expect(trolleyRequired(null, 2)).toBe(false);
  });
});
