import { describe, expect, test } from "bun:test";

import { DIE_STATE_TONE, dieStateKey, pressedBarWidth, pressedPctText, pressedVsPlanned } from "./phone-plan-view";

describe("FP-OP-21 phone plan view", () => {
  test("chip: console run words, Not started before any run; every state has a tone", () => {
    expect(dieStateKey("running")).toBe("press.console.status.running");
    expect(dieStateKey("not_started")).toBe("orders.phonePlan.notStarted");
    expect(DIE_STATE_TONE.running).toBe("green");
    expect(Object.keys(DIE_STATE_TONE).sort()).toEqual(["counting", "die_issued", "logged", "not_started", "queued", "running", "stopped"]);
  });

  test("planned vs pressed text; pieces only when named", () => {
    expect(pressedVsPlanned({ plannedPcs: 150, plannedG: 750_000, pressedPcs: 120, pressedG: 598_000 })).toEqual({
      kg: { pressed: "598.000", planned: "750.000" },
      pcs: { pressed: "120", planned: "150" },
    });
    expect(pressedVsPlanned({ plannedPcs: 0, plannedG: 300_000, pressedPcs: 0, pressedG: 0 }).pcs).toBeNull();
  });

  test("bar clamps at 100; percent text one decimal", () => {
    expect(pressedBarWidth(8224)).toBe("82.2%");
    expect(pressedBarWidth(12_500)).toBe("100.0%");
    expect(pressedBarWidth(0)).toBe("0.0%");
    expect(pressedPctText(8224)).toBe("82.2");
  });
});
