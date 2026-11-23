import { describe, expect, test } from "bun:test";

import {
  defaultRecipeDraft,
  homogActions,
  homogStageIndex,
  homogTone,
  listVerdictTone,
  newBatchIssue,
  noteOk,
  pcsOf,
  readingX10,
  recipeBand,
  recipeInput,
  releaseNeedsNote,
} from "./homog-model";

describe("status and stage", () => {
  test("tone per status", () => {
    expect(homogTone("released")).toBe("green");
    expect(homogTone("held")).toBe("red");
    expect(homogTone("void")).toBe("neutral");
    expect(homogTone("loading")).toBe("blue");
    expect(homogTone("other")).toBe("neutral");
  });
  test("stage index", () => {
    expect(["loading", "in_furnace", "out", "held", "released"].map(homogStageIndex)).toEqual([0, 1, 2, 2, 3]);
  });
  test("list verdict tone", () => {
    expect(listVerdictTone(null)).toBe("neutral");
    expect(listVerdictTone(true)).toBe("green");
    expect(listVerdictTone(false)).toBe("red");
  });
});

describe("actions", () => {
  test("loading with no lines cannot start", () => {
    expect(homogActions("loading", null, 0)).toMatchObject({ load: true, start: false, void: true });
    expect(homogActions("loading", null, 2).start).toBe(true);
  });
  test("in furnace takes readings and comes out", () => {
    expect(homogActions("in_furnace")).toMatchObject({ reading: true, out: true, load: false, release: false });
  });
  test("out: release always, hold only on a failed soak", () => {
    expect(homogActions("out", true)).toMatchObject({ release: true, hold: false });
    expect(homogActions("out", false)).toMatchObject({ release: true, hold: true });
  });
  test("held releases but cannot be held again", () => {
    expect(homogActions("held", false)).toMatchObject({ release: true, hold: false });
  });
  test("released and void allow nothing", () => {
    for (const s of ["released", "void"]) expect(Object.values(homogActions(s, true, 3)).some(Boolean)).toBe(false);
  });
});

describe("release rule", () => {
  test("note needed unless the soak passed", () => {
    expect(releaseNeedsNote("out", true)).toBe(false);
    expect(releaseNeedsNote("out", false)).toBe(true);
    expect(releaseNeedsNote("out", null)).toBe(true);
    expect(releaseNeedsNote("held", true)).toBe(true);
  });
  test("note length", () => {
    expect(noteOk("  ab ")).toBe(false);
    expect(noteOk("ok to go")).toBe(true);
  });
});

describe("recipe", () => {
  test("default draft is valid and frozen as x10", () => {
    expect(recipeInput(defaultRecipeDraft())).toEqual({ ok: true, targetTempX10: 5800, toleranceX10: 100, soakMin: 360 });
  });
  test("bad fields name the field", () => {
    const d = defaultRecipeDraft();
    expect(recipeInput({ ...d, tempC: "200" })).toEqual({ ok: false, field: "temp" });
    expect(recipeInput({ ...d, tempC: "" })).toEqual({ ok: false, field: "temp" });
    expect(recipeInput({ ...d, tempC: "580.55" })).toEqual({ ok: false, field: "temp" });
    expect(recipeInput({ ...d, toleranceC: "0" })).toEqual({ ok: false, field: "band" });
    expect(recipeInput({ ...d, toleranceC: "60" })).toEqual({ ok: false, field: "band" });
    expect(recipeInput({ ...d, soakMin: "5" })).toEqual({ ok: false, field: "soak" });
    expect(recipeInput({ ...d, soakMin: "3000" })).toEqual({ ok: false, field: "soak" });
    expect(recipeInput({ ...d, soakMin: "6.5" })).toEqual({ ok: false, field: "soak" });
  });
  test("new batch needs furnace and alloy first", () => {
    const recipe = defaultRecipeDraft();
    expect(newBatchIssue({ furnaceId: "", alloyId: "a", recipe })).toBe("furnace");
    expect(newBatchIssue({ furnaceId: "f", alloyId: "", recipe })).toBe("alloy");
    expect(newBatchIssue({ furnaceId: "f", alloyId: "a", recipe: { ...recipe, soakMin: "1" } })).toBe("soak");
    expect(newBatchIssue({ furnaceId: "f", alloyId: "a", recipe })).toBeNull();
  });
  test("reading, pieces, band", () => {
    expect(readingX10("580.5")).toBe(5805);
    expect(readingX10("900")).toBeNull();
    expect(readingX10("x")).toBeNull();
    expect(pcsOf("12")).toBe(12);
    expect(pcsOf("0")).toBeNull();
    expect(pcsOf("1.5")).toBeNull();
    expect(recipeBand({ targetTempX10: 5800, toleranceX10: 100 })).toEqual({ lowX10: 5700, highX10: 5900 });
  });
});
