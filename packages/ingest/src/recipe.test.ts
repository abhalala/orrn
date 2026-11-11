import { describe, expect, test } from "bun:test";

import { recipeSchema, blockInputSchema } from "./recipe";
import { EXAMPLE_BAKI_RECIPE, EXAMPLE_DIE_RECIPE } from "./recipe-fixtures";
import { TARGETS, TARGET_ORDER } from "./targets";

describe("recipe schema", () => {
  test("both plan B2 examples parse and round-trip through JSON unchanged", () => {
    for (const r of [EXAMPLE_DIE_RECIPE, EXAMPLE_BAKI_RECIPE]) {
      const parsed = recipeSchema.parse(JSON.parse(JSON.stringify(r)));
      expect(parsed).toEqual(r);
    }
  });

  test("strict: an extra key, an unknown op and a wrong version are refused", () => {
    expect(recipeSchema.safeParse({ ...EXAMPLE_DIE_RECIPE, extra: 1 }).success).toBe(false);
    expect(recipeSchema.safeParse({ ...EXAMPLE_DIE_RECIPE, schemaVersion: 2 }).success).toBe(false);
    const bad = structuredClone(EXAMPLE_DIE_RECIPE);
    (bad.fields[0]!.steps as unknown[]).push({ op: "eval", code: "1" });
    expect(recipeSchema.safeParse(bad).success).toBe(false);
  });

  test("block input schema accepts a described block", () => {
    const ok = blockInputSchema.safeParse({
      ordinal: 0, sheetName: "Baki", title: null, headerRow: 1, headerRows: 1, headers: ["a"], kinds: ["text"],
      headerKey: "k", columnCount: 1, rowCount: 2, sample: [["x"]],
    });
    expect(ok.success).toBe(true);
  });
});

describe("target catalogue", () => {
  test("merge order follows plan B4", () => {
    expect(TARGET_ORDER).toEqual(["customers", "customer_aliases", "vendors", "vendor_aliases", "dies", "die_copies", "bundles", "orders"]);
  });
  test("every field of both examples exists in its target with the same kind", () => {
    for (const r of [EXAMPLE_DIE_RECIPE, EXAMPLE_BAKI_RECIPE]) {
      const t = TARGETS[r.target];
      for (const f of r.fields) {
        const def = t.fields.find((x) => x.name === f.field);
        expect(def, f.field).toBeDefined();
        for (const s of f.steps) if (s.op === "number") expect(def!.kind).toBe(s.kind);
      }
    }
  });
});
