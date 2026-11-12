/**
 * FP-OP-21 (W4-NEXTROWS): the press plan on the owner's phone, read-only. View helpers over
 * `plans.phone`: the run-state chip tone, the planned-vs-pressed line and the summary tiles.
 * Figures are the server's; nothing is summed here.
 */
import { bpPercent1, type Fmt, type PlanDieState, type StatusTone } from "@orrn/domain";

import { kgGrouped3 } from "@/shared/lib/fmt-text";

import { orderKgText } from "./format";

export const DIE_STATE_TONE: Record<PlanDieState, StatusTone> = {
  not_started: "neutral",
  queued: "neutral",
  die_issued: "blue",
  running: "green",
  stopped: "amber",
  counting: "amber",
  logged: "blue",
};

/** The i18n key of the chip text: the console's own run words, "Not started" before any run. */
export function dieStateKey(state: PlanDieState): string {
  return state === "not_started" ? "orders.phonePlan.notStarted" : `press.console.status.${state}`;
}

/**
 * "598.000 of 750.000" style figures for one row; pcs only when the plan named pieces. With the plant's formatter the figures are
 * in the plant's weight unit (the sentence's {massUnit} names it); without one, kg as before.
 */
export function pressedVsPlanned(row: { plannedPcs: number; plannedG: number; pressedPcs: number; pressedG: number }, fmt?: Fmt) {
  const kg = (g: number) => (fmt ? kgGrouped3(fmt, g) : orderKgText(g));
  return {
    kg: { pressed: kg(row.pressedG), planned: kg(row.plannedG) },
    pcs: row.plannedPcs > 0 || row.pressedPcs > 0 ? { pressed: String(row.pressedPcs), planned: String(row.plannedPcs) } : null,
  };
}

/** CSS width of the pressed bar ("82.2%"); a die pressed past plan fills it. */
export function pressedBarWidth(pressedBp: number): string {
  return `${bpPercent1(Math.max(0, Math.min(10_000, pressedBp)))}%`;
}

export function pressedPctText(pressedBp: number): string {
  return bpPercent1(pressedBp);
}
