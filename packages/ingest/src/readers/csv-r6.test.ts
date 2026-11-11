import { describe, expect, test } from "bun:test";

import { detectDelimiter, parseCsv, type CsvDelimiter } from "./csv";

// Round 6, item 5 (M-R5-4): a remark that holds a semicolon or a pipe does not make it the delimiter. The delimiter
// that gives every line the header's count wins; a comma between digits is skipped only when counting it leaves the
// lines uneven. Synthetic files only.

describe("round 6: the CSV delimiter with a semicolon or a pipe in a remark", () => {
  test("C1: a numeric comma file with a semicolon in every remark", () => {
    const s = "Section,Pcs,Kg,Remarks\n4012,12,340,ok; recheck\n4013,8,210,ok; done\n4014,9,220,fine; ok\n";
    expect(detectDelimiter(s)).toBe(",");
    expect(parseCsv(s)[1]).toEqual(["4012", "12", "340", "ok; recheck"]);
  });

  test("C2: a numeric comma file with a pipe in every note", () => {
    const s = "Section,Pcs,Kg,Note\n4012,12,340,a|b\n4013,8,210,c|d\n";
    expect(detectDelimiter(s)).toBe(",");
    expect(parseCsv(s)[2]).toEqual(["4013", "8", "210", "c|d"]);
  });

  test("the cases that already worked still do", () => {
    const cases: [string, CsvDelimiter][] = [
      ["Party;Kg\nOm;12,5\nMehta;3,25\n", ";"],
      ['Party,Amount\nOm,"1,00,000"\nMehta,"2,50,000"\n', ","],
      ["Party\tAmount\nOm\t1,00,000\nMehta\t2,50,000\n", "\t"],
      ["4012,12,340\n4013,8,210\n4014,9,220\n", ","],
      ["Party,Kg,Rate\nOm; Rajkot,12,245\nMehta,13,250\nShree; Morbi,14,255\nPatel,15,260\n", ","],
      ["Party,Amount\nOm,1,00,000\nMehta,2,50,000\n", ","],
      ["Order book\nParty|Kg|Rate\nOm|12|245\nMehta|13|250\n", "|"],
      ["Party;Kg;Note\nOm;12;a, b\nMehta;13;c, d\n", ";"],
      ["Party\tNote\nOm\tok; fine\nMehta\tok; done\n", "\t"],
      // Key and value lines above a comma table whose remarks all hold a semicolon (found by the round 6 property).
      ["Party:,Om Metals,City:,Rajkot\nPhone,9812345678\nSection,Pcs,Kg,Remarks\nK1100,815,34.61,hold; fine\nK1100,830,42.00,ok; done\nF3301,12,3.50,ok; late\n", ","],
      // A comma table whose notes all hold a pipe, with a second table at the end of the sample.
      ["Section,Pcs,Kg,Remarks\nF3301,251,39.63,recheck| done\nK1100,96,6.31,recheck| late\nR2105,130,19.50,hold| late\nR2105,340,42.17,recheck| done\nT4012,655,37.93,hold| done\nF3301,620,28.27,ok| done\n\n\nName,City,Phone\nOm,Surat,9816282336\nMehta,Rajkot,9875843530\n", ","],
    ];
    for (const [s, d] of cases) expect(detectDelimiter(s), JSON.stringify(s)).toBe(d);
  });
});
