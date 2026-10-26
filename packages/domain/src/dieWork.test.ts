/** FP-DR-18 die work log (W4-NEXTROWS): which copies take work, and `correct` sending a copy on trial. */
import { describe, expect, test } from "bun:test";

import { dieCopyNext, dieWorkCheck } from "./dieRoom";
import { DEFAULT_REASON_CODES, REASON_CODE_KINDS } from "./reasonCodes";

describe("dieWorkCheck", () => {
  test("rack copies take work; the status stays without setOnTrial", () => {
    expect(dieWorkCheck({ status: "available", code: "polish" })).toEqual({ ok: true, nextStatus: "available", movesToTrial: false });
    expect(dieWorkCheck({ status: "on_trial", code: "inspect" })).toEqual({ ok: true, nextStatus: "on_trial", movesToTrial: false });
  });
  test("a correction may send an available copy back on trial; one on trial stays", () => {
    expect(dieWorkCheck({ status: "available", code: "correct", setOnTrial: true })).toEqual({ ok: true, nextStatus: "on_trial", movesToTrial: true });
    expect(dieWorkCheck({ status: "on_trial", code: "correct", setOnTrial: true })).toEqual({ ok: true, nextStatus: "on_trial", movesToTrial: false });
  });
  test("only a correction sets on trial", () => {
    expect(dieWorkCheck({ status: "available", code: "polish", setOnTrial: true })).toEqual({ ok: false, refusal: "trial_needs_correct" });
  });
  test("refused off the rack", () => {
    expect(dieWorkCheck({ status: "in_use", code: "polish" })).toEqual({ ok: false, refusal: "copy_in_use" });
    expect(dieWorkCheck({ status: "at_maker", code: "polish" })).toEqual({ ok: false, refusal: "copy_at_maker" });
    expect(dieWorkCheck({ status: "at_nitriding", code: "clean" })).toEqual({ ok: false, refusal: "copy_at_nitriding" });
    expect(dieWorkCheck({ status: "retired", code: "inspect" })).toEqual({ ok: false, refusal: "copy_retired" });
  });
  test("workCorrect event: available -> on_trial only", () => {
    expect(dieCopyNext("available", "workCorrect")).toBe("on_trial");
    expect(dieCopyNext("on_trial", "workCorrect")).toBeNull();
  });
  test("die_work reason kind seeds polish, correct, inspect, clean, other (note required)", () => {
    expect(REASON_CODE_KINDS).toContain("die_work");
    expect(DEFAULT_REASON_CODES.die_work.map((r) => r.code)).toEqual(["polish", "correct", "inspect", "clean", "other"]);
    expect(DEFAULT_REASON_CODES.die_work.find((r) => r.code === "other")?.requiresNote).toBe(true);
  });
});
