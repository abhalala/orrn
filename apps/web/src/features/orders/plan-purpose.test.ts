import { describe, expect, test } from "bun:test";

import {
  copyStatusesFor,
  isTrialPurpose,
  PLAN_PURPOSES,
  trialDraftProblems,
  trialPlanInput,
  trialPlanNote,
} from "./plan-purpose";

describe("plan purpose", () => {
  test("production is the first and default purpose; the others follow the server's enum", () => {
    expect(PLAN_PURPOSES).toEqual(["production", "die_trial", "sample", "other"]);
    expect(isTrialPurpose("production")).toBe(false);
    for (const p of ["die_trial", "sample", "other"] as const) expect(isTrialPurpose(p)).toBe(true);
  });

  test("a die trial offers only copies on trial; sample and other offer the rack and trial copies", () => {
    expect(copyStatusesFor("die_trial")).toEqual(["on_trial"]);
    expect(copyStatusesFor("sample")).toEqual(["available", "on_trial"]);
    expect(copyStatusesFor("other")).toEqual(["available", "on_trial"]);
    expect(copyStatusesFor("production")).toEqual([]);
  });

  test("the planned copy and quantity are kept in the plan note", () => {
    expect(trialPlanNote({ copyCode: "13090-11", kgText: "500", pcsText: "120" })).toBe("13090-11 · 500 kg · 120 pcs");
    expect(trialPlanNote({ copyCode: null, kgText: "12.5", pcsText: "" })).toBe("12.5 kg");
    expect(trialPlanNote({ copyCode: null, kgText: "", pcsText: "" })).toBeNull();
    expect(trialPlanNote({ copyCode: "T-1", kgText: "", pcsText: "" })).toBe("T-1");
  });

  test("problems: a die is needed, a quantity that is typed must be a number", () => {
    expect(trialDraftProblems({ sectionId: "", kgText: "", pcsText: "" })).toEqual({ die: true });
    expect(trialDraftProblems({ sectionId: "s1", kgText: "", pcsText: "" })).toEqual({});
    expect(trialDraftProblems({ sectionId: "s1", kgText: "abc", pcsText: "2.5" })).toEqual({ kg: true, pcs: true });
    expect(trialDraftProblems({ sectionId: "s1", kgText: "0", pcsText: "0" })).toEqual({ kg: true, pcs: true });
    expect(trialDraftProblems({ sectionId: "s1", kgText: "40", pcsText: "10" })).toEqual({});
  });

  test("the create input carries the purpose, one die, no order lines and no kg per line", () => {
    const input = trialPlanInput({
      purpose: "die_trial",
      sectionId: "s1",
      copyCode: "13090-11",
      kgText: "500",
      pcsText: "",
      windowStart: 1_000,
      windowEnd: 2_000,
      pressLineId: "",
    });
    expect(input).toEqual({
      purpose: "die_trial",
      windowStart: 1_000,
      windowEnd: 2_000,
      note: "13090-11 · 500 kg",
      dies: [{ sectionId: "s1", lines: [] }],
    });
    const withPress = trialPlanInput({
      purpose: "sample",
      sectionId: "s2",
      copyCode: null,
      kgText: "",
      pcsText: "",
      windowStart: 1,
      windowEnd: 2,
      pressLineId: "pl-1",
    });
    expect(withPress).toEqual({ purpose: "sample", windowStart: 1, windowEnd: 2, pressLineId: "pl-1", dies: [{ sectionId: "s2", lines: [] }] });
  });
});
