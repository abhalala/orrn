import { describe, expect, test } from "bun:test";

import { PLAN_DIE_TONE, planBarWidth, planDieLabelKey, showsPhonePlan } from "../features/press/plan-phone-model";

const me = (role: string) => ({ company: { role }, isPlatformAdmin: false }) as never;

describe("FP-OP-21 phone plan (native)", () => {
  test("owner, manager, office and viewer see it; press and packer do not", () => {
    expect(["owner", "manager", "office", "viewer", "supervisor"].map((r) => showsPhonePlan(me(r)))).toEqual([true, true, true, true, true]);
    expect(["press", "packer", "die_room"].map((r) => showsPhonePlan(me(r)))).toEqual([false, false, false]);
    expect(showsPhonePlan(null)).toBe(false);
  });

  test("chip words and tones; bar clamps", () => {
    expect(planDieLabelKey("not_started")).toBe("native.press.planNotStarted");
    expect(planDieLabelKey("counting")).toBe("press.console.status.counting");
    expect(PLAN_DIE_TONE.running).toBe("green");
    expect([planBarWidth(8224), planBarWidth(15_000), planBarWidth(-5)]).toEqual(["82.2%", "100.0%", "0.0%"]);
  });
});
