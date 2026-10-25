import { describe, expect, test } from "bun:test";

import { SHEET_GRID, isSheetSize, pageCount, paginateLabels, standardLine, stickerPartyNo } from "./label-sheet-model";

describe("A4 sticker sheet layout", () => {
  test("ten stickers a page: 2 columns by 5 rows; 21 a page: 3 by 7", () => {
    expect(SHEET_GRID[10].cols * SHEET_GRID[10].rows).toBe(10);
    expect(SHEET_GRID[21].cols * SHEET_GRID[21].rows).toBe(21);
    expect(isSheetSize(10)).toBe(true);
    expect(isSheetSize(12)).toBe(false);
  });

  test("labels fill pages in order and the last page is padded with empty stickers", () => {
    const pages = paginateLabels(Array.from({ length: 12 }, (_, i) => `L${i + 1}`), 10);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8", "L9", "L10"]);
    expect(pages[1]!.slice(0, 2)).toEqual(["L11", "L12"]);
    expect(pages[1]!.filter((x) => x === null)).toHaveLength(8);
  });

  test("a part-used sheet starts after the stickers already taken", () => {
    const pages = paginateLabels(["A", "B"], 10, 3);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.slice(0, 5)).toEqual([null, null, null, "A", "B"]);
  });

  test("skip is clamped so a sheet always has a slot, and 12 labels after 4 skipped need two pages", () => {
    expect(paginateLabels(["A"], 10, 99)[0]!.indexOf("A")).toBe(9);
    expect(pageCount(12, 10, 4)).toBe(2);
    expect(pageCount(6, 10, 4)).toBe(1);
    expect(pageCount(7, 10, 4)).toBe(2);
    expect(pageCount(0, 10)).toBe(1);
  });

  test("sticker text: standard and CM/L, party number only when it differs", () => {
    expect(standardLine({ standard: "IS 733", cml: "1234" })).toBe("IS 733 · CM/L 1234");
    expect(standardLine({ standard: "IS 733", cml: "" })).toBe("IS 733");
    expect(standardLine({ standard: "", cml: "" })).toBe("");
    expect(stickerPartyNo({ serial: "26J4086", partyNo: "26J12" })).toBe("26J12");
    expect(stickerPartyNo({ serial: "26J4086", partyNo: "26J4086" })).toBeNull();
  });
});
