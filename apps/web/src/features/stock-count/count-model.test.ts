import { describe, expect, test } from "bun:test";

import { bpText, chunkCodes, codesFromPaste, coversEveryYard, matchKey, matchTone, needsUnscannedConfirm, signed, varianceTotal } from "./count-model";

describe("count codes", () => {
  test("pasted codes: one per line or comma, trimmed, each once, order kept", () => {
    expect(codesFromPaste("26J4086\n 26J4087 ,26j4086;\n\nlot/7a\r\nLOT/7A")).toEqual(["26J4086", "26J4087", "lot/7a"]);
    expect(codesFromPaste("   \n,,")).toEqual([]);
  });

  test("a long list goes in chunks of 200", () => {
    const codes = Array.from({ length: 450 }, (_, i) => `C${i}`);
    expect(chunkCodes(codes).map((c) => c.length)).toEqual([200, 200, 50]);
    expect(chunkCodes([])).toEqual([]);
  });
});

describe("what a scan found", () => {
  test("keys and tones", () => {
    expect(matchKey("here")).toBe("stock.count.match.here");
    expect(matchTone("here")).toBe("green");
    expect(matchTone("moved")).toBe("amber");
    expect(matchTone("elsewhere")).toBe("amber");
    expect(matchTone("not_in_stock")).toBe("amber");
    expect(matchTone("unknown")).toBe("red");
    expect(matchTone("ambiguous")).toBe("red");
  });
});

describe("numbers", () => {
  test("phantom share and signed variance", () => {
    expect(bpText(120)).toBe("1.2%");
    expect(bpText(0)).toBe("0.0%");
    expect(signed(3)).toBe("+3");
    expect(signed(-2)).toBe("-2");
    expect(signed(0)).toBe("0");
    expect(signed(1200)).toBe("+1,200");
  });

  test("variance footer adds the rows", () => {
    expect(varianceTotal([{ expected: 10, counted: 8, variance: 2 }, { expected: 5, counted: 6, variance: -1 }])).toEqual({ expected: 15, counted: 14, variance: 1 });
  });
});

describe("close and start rules", () => {
  test("an unscanned yard needs a second, deliberate close", () => {
    expect(needsUnscannedConfirm({ data: { code: "PRECONDITION_FAILED" } })).toBe(true);
    expect(needsUnscannedConfirm({ data: { code: "BAD_REQUEST" } })).toBe(false);
    expect(needsUnscannedConfirm(null)).toBe(false);
  });

  test("every active yard counted means bundles with no yard are expected too", () => {
    expect(coversEveryYard(new Set(["a", "b"]), ["a", "b"])).toBe(true);
    expect(coversEveryYard(new Set(["a"]), ["a", "b"])).toBe(false);
    expect(coversEveryYard(new Set(), [])).toBe(false);
  });
});
