import { describe, expect, test } from "bun:test";

import { detectDelimiter } from "./csv";

describe("C35: delimiter detection under a title line", () => {
  test("a titled semicolon CSV is semicolon", () => {
    expect(detectDelimiter("Stock list\nSeries;Section;Qty\nR;2105;4\nR;2106;5\n")).toBe(";");
  });
  test("plain comma CSV stays comma", () => {
    expect(detectDelimiter("a,b,c\n1,2,3\n")).toBe(",");
  });
});
