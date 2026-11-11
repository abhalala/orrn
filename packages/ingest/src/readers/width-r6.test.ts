import { describe, expect, test } from "bun:test";

import { describeBlock } from "../fingerprint";
import { chooseHeader } from "../header";
import { readSheet } from "./blocks";
import { readCsv } from "./csv";
import { sqlTablesToBlocks } from "./sql";
import { layoutOf } from "./trust-helpers";

// Round 6, item 4 (M-R5-2): a block reports its region width (its widest row), and a blank header cell matches by
// position against that width. An approved layout with an unnamed column still fits when that column is filled only
// below the preview. Synthetic sheets only.

const HEADERS = ["Party", "Order No", "PO", "Section", "Cut Length (mm)", "Pcs", "Kg", "Rate"];
const sheet = (at: number) => [HEADERS, ...Array.from({ length: 60 }, (_, i) => ["Om", String(100 + i), `PO${i}`, "T4012", "3660", "12", "340", "245", ...(i === at ? ["urgent"] : [])])];

describe("round 6: the block's region width", () => {
  test("a sheet block reports its widest row, a column filled only far below included", () => {
    expect(readSheet(sheet(40)).blocks[0]!.width).toBe(9);
    expect(readSheet(sheet(-1)).blocks[0]!.width).toBe(8);
    expect(readSheet(sheet(40), { hints: [{ headerRow: 0 }] }).blocks[0]!.width).toBe(9);
  });

  test("a CSV block and a dump table report their width", () => {
    expect(readCsv("Party,Kg\nOm,12\nMehta,8,late\n").blocks[0]!.width).toBe(3);
    expect(sqlTablesToBlocks([{ schema: null, name: "t", columns: ["a", "b", "c"], rows: [["1", "2", "3"]] } as never])[0]!.width).toBe(3);
  });

  for (const at of [5, 40]) {
    test(`an approved layout with an unnamed column fits the same file again (remark at data row ${at})`, () => {
      const b = readSheet(sheet(at)).blocks[0]!;
      const layout = layoutOf(describeBlock(b, 0).headers, "ob");
      expect(layout.recipe.match.headers.length).toBe(9);
      const c = chooseHeader(b, { learned: [layout] });
      expect(c.kind).toBe("fits");
      if (c.kind === "fits") expect([c.headerRow, c.fit.name]).toEqual([0, "ob"]);
    });
  }

  test("without the width, the preview alone still decides (the old shape)", () => {
    const b = readSheet(sheet(40)).blocks[0]!;
    const layout = layoutOf(describeBlock(b, 0).headers, "ob");
    expect(chooseHeader({ preview: b.preview, guess: b.guess }, { learned: [layout] }).kind).toBe("ask");
    expect(chooseHeader({ preview: b.preview, guess: b.guess, width: 9 }, { learned: [layout] }).kind).toBe("fits");
  });
});
