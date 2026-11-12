import { describe, expect, test } from "bun:test";

import { normalizeHeader } from "../fingerprint";
import { readSheet, toCellText } from "./blocks";
import { CsvParser, parseCsv } from "./csv";

// Round 7, item 5: the two open minors.

describe("a space before a quote in CSV", () => {
  test("spaces before an opening quote are dropped and the quoted field is one cell", () => {
    expect(parseCsv('Party,City\nOm, "Mehta, Rajkot"\nKamal,  "Morbi, Gujarat"\n')).toEqual([["Party", "City"], ["Om", "Mehta, Rajkot"], ["Kamal", "Morbi, Gujarat"]]);
    expect(parseCsv('a; "b; c";d\n', { delimiter: ";" })).toEqual([["a", "b; c", "d"]]);
  });

  test("a quote after other text is still a character (an inch mark)", () => {
    expect(parseCsv('Item,Size\nPipe, 5" dia\n')).toEqual([["Item", "Size"], ["Pipe", ' 5" dia']]);
  });

  test("the same holds when the text arrives in pieces", () => {
    const text = 'Party,City\nOm, "Mehta, Rajkot"\n';
    for (let cut = 1; cut < text.length; cut++) {
      const p = new CsvParser({ delimiter: "," });
      p.push(text.slice(0, cut));
      p.push(text.slice(cut));
      expect(p.end()[1]).toEqual(["Om", "Mehta, Rajkot"]);
    }
  });
});

describe("format characters, the same in names and in cells", () => {
  const ZWNJ = "‌";
  const ZWJ = "‍";
  test("U+200C and U+200D are kept; every other format character is dropped", () => {
    const word = `क्${ZWJ}ष`;
    expect(normalizeHeader(word)).toBe(word);
    expect(normalizeHeader(`ર${ZWNJ}મ`)).toBe(`ર${ZWNJ}મ`);
    expect(normalizeHeader(`Pa­rty​ Name⁠﻿`)).toBe("party name");
    expect(toCellText(word)).toBe(word);
    expect(toCellText(`ર${ZWNJ}મ`)).toBe(`ર${ZWNJ}મ`);
    expect(toCellText(`Om​ Me­tals⁠﻿`)).toBe("Om Metals");
    expect(toCellText("‪Rajkot‬")).toBe("Rajkot");
  });

  test("a header cell and its key agree: a joiner kept in the cell is kept in the key", () => {
    const b = readSheet([[`क्${ZWJ}ष`, "Kg​"], ["Om", "12"]]).blocks[0]!;
    expect(b.headers).toEqual([`क्${ZWJ}ष`, "Kg"]);
    expect(b.headers.map(normalizeHeader)).toEqual([`क्${ZWJ}ष`, "kg"]);
  });
});
