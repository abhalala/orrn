import { describe, expect, test } from "bun:test";

import { offsetParam, searchTermParam } from "./search-param";

describe("searchTermParam", () => {
  test("a typed term is trimmed; blank is absent", () => {
    expect(searchTermParam("  KD Extrusion ")).toBe("KD Extrusion");
    expect(searchTermParam("   ")).toBeUndefined();
    expect(searchTermParam(undefined)).toBeUndefined();
  });

  test("a numeric term from a hand-typed URL (?q=14701 parses as a number) is kept as text", () => {
    expect(searchTermParam(14701)).toBe("14701");
    expect(searchTermParam(9825011234)).toBe("9825011234");
  });

  test("anything else is dropped", () => {
    expect(searchTermParam(Number.NaN)).toBeUndefined();
    expect(searchTermParam({ a: 1 })).toBeUndefined();
    expect(searchTermParam(true)).toBeUndefined();
  });
});

describe("offsetParam", () => {
  test("positive whole offsets only", () => {
    expect(offsetParam(50)).toBe(50);
    expect(offsetParam(50.7)).toBe(50);
    expect(offsetParam("100")).toBe(100);
    expect(offsetParam(0)).toBeUndefined();
    expect(offsetParam(-5)).toBeUndefined();
    expect(offsetParam("x")).toBeUndefined();
  });
});
