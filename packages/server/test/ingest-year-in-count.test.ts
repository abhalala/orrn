/**
 * Design fix B1: the list row says whether the server's open count already holds the year, so the list counts
 * what the review page counts. Pure: no database.
 */
import { describe, expect, test } from "bun:test";

import { EXAMPLE_BAKI_RECIPE, EXAMPLE_DIE_RECIPE, type Recipe } from "@orrn/ingest";

import { candidateSummary } from "../src/lib/ingest/core";

const row = (target: string, recipe: Recipe) =>
  ({
    id: "c1", artifactId: "a1", blockId: "b1", parentId: null, target, holeRef: null, fit: "exact", fitScore: 1000, state: "ready",
    reasonCode: null, reasonDetail: null, serverSeq: 1, dryCursor: 0, openQuestions: 1, botAttempts: 0, recipeLocked: false, recipe,
    rowsTotal: 0, rowsCreate: 0, rowsUpdate: 0, rowsUnchanged: 0, rowsAmbiguous: 0, rowsConflict: 0, rowsRefused: 0, rowsSkipped: 0,
    rowsWritten: 0, rowsFilled: 0, rowsSkippedByPerson: 0, updatedAt: new Date(0),
  }) as never;
const extras = { fileName: "f.xlsx", sheetName: null, blockOrdinal: 0, holeName: null };

describe("periodInCount", () => {
  test("an orders layout that reads its date from the period holds the year in the count", () => {
    const recipe = structuredClone(EXAMPLE_BAKI_RECIPE) as Recipe;
    recipe.fields = recipe.fields.map((f) => (f.field === "orderDate" ? { field: "orderDate", source: { kind: "period_as_of" }, steps: [] } : f)) as Recipe["fields"];
    expect(candidateSummary(row("orders", recipe), extras).periodInCount).toBe(true);
  });

  test("an orders layout with a date column does not: the page's own year line is the extra question", () => {
    expect(candidateSummary(row("orders", EXAMPLE_BAKI_RECIPE), extras).periodInCount).toBe(false);
  });

  test("a die layout never does", () => {
    expect(candidateSummary(row("dies", EXAMPLE_DIE_RECIPE), extras).periodInCount).toBe(false);
  });
});
