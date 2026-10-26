import { describe, expect, test } from "bun:test";

import { PLAN_DIE_TONE, planBarWidth, planDieLabelKey, showsPhonePlan } from "../features/press/plan-phone-model";
import { reachableTabs } from "../lib/nav";

const me = (role: string) => ({ company: { role }, isPlatformAdmin: false }) as never;

describe("FP-OP-21 phone plan (native)", () => {
  test("the plan is allowed by permission for office and viewer too, but only owner, admin, manager and supervisor reach it on the phone", () => {
    // Permission (reports.read or order.plan): the model.
    expect(["owner", "admin", "manager", "supervisor", "office", "viewer"].map((r) => showsPhonePlan(me(r)))).toEqual([true, true, true, true, true, true]);
    expect(["press", "packer", "die_room"].map((r) => showsPhonePlan(me(r)))).toEqual([false, false, false]);
    expect(showsPhonePlan(null)).toBe(false);
    // The screen: it is drawn on the Press tab (lines-view), so a role needs that tab. The office bar has no Press
    // tab and `extraTabs` needs press.run / press.close, so office and viewer never reach it (they read it on web).
    const full = (r: string) => ({ user: { id: "u", name: "A", email: "a@b.in" }, company: { id: "c", name: "P", slug: "p", status: "active", plan: null, role: r, modules: [] }, isPlatformAdmin: false }) as never;
    const sees = (r: string) => showsPhonePlan(full(r)) && reachableTabs(full(r)).includes("press");
    expect(["owner", "admin", "manager", "supervisor"].map(sees)).toEqual([true, true, true, true]);
    expect(["office", "viewer", "press", "packer", "die_room"].map(sees)).toEqual([false, false, false, false, false]);
  });

  test("chip words and tones; bar clamps", () => {
    expect(planDieLabelKey("not_started")).toBe("native.press.planNotStarted");
    expect(planDieLabelKey("counting")).toBe("press.console.status.counting");
    expect(PLAN_DIE_TONE.running).toBe("green");
    expect([planBarWidth(8224), planBarWidth(15_000), planBarWidth(-5)]).toEqual(["82.2%", "100.0%", "0.0%"]);
  });
});
