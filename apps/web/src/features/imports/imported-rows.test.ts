import { describe, expect, test } from "bun:test";

import {
  IMPORTED_ROWS_CAP,
  loadImportedRows,
  rememberImportedRows,
  rowFingerprint,
  splitAlreadyImported,
} from "./imported-rows";
import type { BundleImportRow } from "./parse";
import type { ImportOp } from "./submit";

function memoryStorage(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

const data = (over: Partial<BundleImportRow> = {}): BundleImportRow => ({
  dieSeries: "40",
  dieSectionCode: "4012",
  quantity: 20,
  weightG: 47_900,
  lengthMm: 3505,
  poNumber: null,
  ...over,
});
const op = (row: number, over: Partial<BundleImportRow> = {}): ImportOp<BundleImportRow> => ({ row, data: data(over) });

describe("rowFingerprint", () => {
  test("same sheet row and same values give the same fingerprint; either one changing gives another", () => {
    const a = rowFingerprint("bundles", 5, data());
    expect(rowFingerprint("bundles", 5, data())).toBe(a);
    expect(rowFingerprint("bundles", 6, data())).not.toBe(a);
    expect(rowFingerprint("bundles", 5, data({ weightG: 47_901 }))).not.toBe(a);
    expect(rowFingerprint("customers", 5, data() as never)).not.toBe(a);
  });
});

describe("remembering imported rows", () => {
  test("rows remembered for a company are found again; another company or kind sees none", () => {
    const s = memoryStorage();
    rememberImportedRows(s, "co-1", "bundles", [op(2), op(3)]);
    expect(loadImportedRows(s, "co-1", "bundles").size).toBe(2);
    expect(loadImportedRows(s, "co-2", "bundles").size).toBe(0);
    expect(loadImportedRows(s, "co-1", "customers").size).toBe(0);
  });

  test("later chunks add to what is remembered", () => {
    const s = memoryStorage();
    rememberImportedRows(s, "co-1", "bundles", [op(2)]);
    rememberImportedRows(s, "co-1", "bundles", [op(3)]);
    expect(loadImportedRows(s, "co-1", "bundles").size).toBe(2);
  });

  test("the oldest are dropped past the cap", () => {
    const s = memoryStorage();
    const many = Array.from({ length: IMPORTED_ROWS_CAP + 5 }, (_, i) => op(i + 2, { weightG: 1000 + i }));
    rememberImportedRows(s, "co-1", "bundles", many);
    const kept = loadImportedRows(s, "co-1", "bundles");
    expect(kept.size).toBe(IMPORTED_ROWS_CAP);
    expect(kept.has(rowFingerprint("bundles", 2, many[0]!.data))).toBe(false);
    expect(kept.has(rowFingerprint("bundles", many.length + 1, many.at(-1)!.data))).toBe(true);
  });

  test("blocked, corrupt or throwing storage never breaks an import", () => {
    expect(loadImportedRows(null, "co-1", "bundles").size).toBe(0);
    expect(() => rememberImportedRows(null, "co-1", "bundles", [op(2)])).not.toThrow();
    const s = memoryStorage();
    rememberImportedRows(s, "co-1", "bundles", [op(2)]);
    const key = [...s.map.keys()][0]!;
    for (const junk of ["{", "null", '{"a":1}', "[1,2]"]) {
      s.setItem(key, junk);
      expect(loadImportedRows(s, "co-1", "bundles").size).toBe(0);
    }
    const throwing = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(loadImportedRows(throwing, "co-1", "bundles").size).toBe(0);
    expect(() => rememberImportedRows(throwing, "co-1", "bundles", [op(2)])).not.toThrow();
  });
});

describe("splitAlreadyImported: re-importing a corrected whole sheet", () => {
  test("rows saved by the first import become 'already imported' problems; fixed rows still go", () => {
    const s = memoryStorage();
    // First import: rows 2 and 6 saved; rows 3 to 5 were problems and never sent.
    rememberImportedRows(s, "co-1", "bundles", [op(2), op(6, { weightG: 50_000 })]);
    // The corrected sheet: rows 3 to 5 now fine, rows 2 and 6 unchanged.
    const second = [op(2), op(3), op(4), op(5), op(6, { weightG: 50_000 })];
    const { ops, blocked } = splitAlreadyImported("bundles", second, loadImportedRows(s, "co-1", "bundles"), "Section code");
    expect(ops.map((o) => o.row)).toEqual([3, 4, 5]);
    expect(blocked).toEqual([
      { row: 2, reason: "imports.reason.alreadyImported", column: "Section code" },
      { row: 6, reason: "imports.reason.alreadyImported", column: "Section code" },
    ]);
  });

  test("a row with the same values on another sheet row is a different bundle and goes", () => {
    const s = memoryStorage();
    rememberImportedRows(s, "co-1", "bundles", [op(2)]);
    const { ops, blocked } = splitAlreadyImported("bundles", [op(3)], loadImportedRows(s, "co-1", "bundles"), "Section code");
    expect(ops).toHaveLength(1);
    expect(blocked).toEqual([]);
  });

  test("nothing remembered: every row goes", () => {
    const { ops, blocked } = splitAlreadyImported("bundles", [op(2), op(3)], new Set(), "Section code");
    expect(ops).toHaveLength(2);
    expect(blocked).toEqual([]);
  });
});
