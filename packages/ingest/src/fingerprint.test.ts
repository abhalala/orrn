import { describe, expect, test } from "bun:test";

import { inferKind, kindsCompatible } from "./cells";
import { describeBlock, fingerprint, headerKey, normalizeHeader, normalizeHeaders } from "./fingerprint";

describe("normalizeHeader", () => {
  test("lower case, units canonical, punctuation one space", () => {
    // Round 7, rule 6.2: "/" between two words is a separator. This pinned "kg/12ft"; it now pins "kg 12ft".
    expect(normalizeHeader("Min Weight (Kgs/12ft)")).toBe("min weight kg 12ft");
    expect(normalizeHeader("Length (Mtrs)")).toBe("length m");
    expect(normalizeHeader("Length (feet)")).toBe("length ft");
    expect(normalizeHeader("Cut length 12'")).toBe("cut length 12 ft");
    // Round 6 (owner's decision): "Nos" is its own count word, no longer folded into "pcs". These two lines pinned
    // the old fold; they now pin the new rule.
    expect(normalizeHeader("Qty (Nos)")).toBe("qty no");
    // C27: "No." is a number column, not a count. "PO No" and "PO No." get one key.
    expect(normalizeHeader("Bundle No.")).toBe("bundle no");
    expect(normalizeHeader("Bundle Nos")).toBe("bundle no");
    expect(normalizeHeader("PO No.")).toBe(normalizeHeader("PO No"));
    expect(normalizeHeader("Rate (Rs.)")).toBe("rate inr");
    expect(normalizeHeader("Rate ₹")).toBe("rate inr");
    expect(normalizeHeader("Ｗeight   (ＫＧ)")).toBe("weight kg");
  });
  test("a blank header becomes _index and trailing blank columns drop", () => {
    expect(normalizeHeaders(["A", "", "C"])).toEqual(["a", "_1", "c"]);
    const fp = fingerprint({ headers: ["A", "B", "", ""], rows: [["1", "x", "", ""]] });
    expect(fp.normalized).toEqual(["a", "b"]);
    expect(fp.columnCount).toBe(2);
  });
  test("a trailing blank header with data under it stays", () => {
    const fp = fingerprint({ headers: ["A", ""], rows: [["1", "x"]] });
    expect(fp.normalized).toEqual(["a", "_1"]);
  });
});

describe("headerKey", () => {
  test("order matters", () => {
    expect(headerKey(["a", "b"])).not.toBe(headerKey(["b", "a"]));
    expect(headerKey(["a", "b"])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("kinds", () => {
  test("test order and the 90% rule", () => {
    expect(inferKind(["31/10/2025", "01-11-2025"])).toBe("date");
    expect(inferKind(["12 Oct 2025", "3 Nov 2025"])).toBe("date");
    expect(inferKind(["2025-10-31", "2025-11-01"])).toBe("date");
    expect(inferKind(["1", "2", "3,000"])).toBe("int");
    expect(inferKind(["1.5", "2", "3.25"])).toBe("decimal");
    expect(inferKind(["R2105", "4012", "B12"])).toBe("mixed");
    expect(inferKind(["R2105", "T4012", "B12"])).toBe("code");
    expect(inferKind(["Shree Ganesh", "Om Metals"])).toBe("text");
    expect(inferKind(["", "  "])).toBe("empty");
    const nine = [...Array(9).fill("12"), "abc"];
    expect(inferKind(nine)).toBe("int");
    const eight = [...Array(8).fill("12"), "abc", "def"];
    expect(inferKind(eight)).toBe("mixed");
  });
  test("compatible: equal, int with decimal, empty or mixed", () => {
    expect(kindsCompatible("int", "decimal")).toBe(true);
    expect(kindsCompatible("date", "text")).toBe(false);
    expect(kindsCompatible("mixed", "date")).toBe(true);
    expect(kindsCompatible("empty", "code")).toBe(true);
    expect(kindsCompatible("code", "text")).toBe(false);
  });
});

describe("fingerprint stability", () => {
  const headers = ["Party Name", "Date", "Qty", "Rate"];
  const rows = Array.from({ length: 60 }, (_, i) => [`Party ${i}`, `${(i % 28) + 1}/10/2025`, String(i + 1), `${200 + i}.5`]);

  function shuffled<T>(xs: T[], seed: number): T[] {
    const a = [...xs];
    let s = seed;
    for (let i = a.length - 1; i > 0; i--) {
      s = (s * 1664525 + 1013904223) % 4294967296;
      const j = s % (i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  test("row reordering changes nothing", () => {
    const base = fingerprint({ headers, rows });
    for (const seed of [1, 2, 3, 4, 5]) {
      const f = fingerprint({ headers, rows: shuffled(rows, seed) });
      expect(f.headerKey).toBe(base.headerKey);
      expect(f.kinds).toEqual(base.kinds);
    }
    expect(base.kinds).toEqual(["text", "date", "int", "decimal"]);
  });

  test("row reordering with more than 200 rows keeps clean columns the same", () => {
    const big = Array.from({ length: 600 }, (_, i) => [`P${i}`, String(i), `${i}.25`]);
    const a = fingerprint({ headers: ["A", "B", "C"], rows: big });
    const b = fingerprint({ headers: ["A", "B", "C"], rows: shuffled(big, 9) });
    expect(b.kinds).toEqual(a.kinds);
  });

  test("trailing blank columns change nothing", () => {
    const base = fingerprint({ headers, rows });
    const padded = fingerprint({ headers: [...headers, "", "  ", ""], rows: rows.map((r) => [...r, "", "", ""]) });
    expect(padded.headerKey).toBe(base.headerKey);
    expect(padded.columnCount).toBe(base.columnCount);
    expect(padded.kinds).toEqual(base.kinds);
  });

  test("describeBlock gives a block input with a short sample", () => {
    const b = describeBlock({ sheetName: "S", title: null, headerRow: 0, headerRows: 1, headers, rows }, 3);
    expect(b.ordinal).toBe(3);
    expect(b.rowCount).toBe(60);
    expect(b.sample.length).toBe(20);
    expect(b.headerKey).toBe(fingerprint({ headers, rows }).headerKey);
  });
});
