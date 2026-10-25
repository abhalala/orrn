/**
 * FP-OP-21 (W4-NEXTROWS): the press plan on the owner's phone, read-only (`plans.phone`). Who sees
 * it (reports.read or order.plan), the chip tone and words per die, the bar width. Pure.
 */
import { bpPercent1, type PlanDieState, type StatusTone } from "@orrn/domain";
import { can, type MeLike } from "@orrn/server/lib/permissions";

export const PLAN_DIE_TONE: Record<PlanDieState, StatusTone> = {
  not_started: "neutral",
  queued: "neutral",
  die_issued: "blue",
  running: "green",
  stopped: "amber",
  counting: "amber",
  logged: "blue",
};

export function planDieLabelKey(state: PlanDieState): string {
  return state === "not_started" ? "native.press.planNotStarted" : `press.console.status.${state}`;
}

/** The owner, manager, office and readers see the plan; the press role keeps its lines board only. */
export function showsPhonePlan(me: MeLike | null | undefined): boolean {
  if (!me) return false;
  return can(me, "reports.read") || can(me, "order.plan");
}

/** CSS width of the pressed bar ("82.2%"); a die pressed past plan fills it. Percent text via bpPercent1. */
export function planBarWidth(pressedBp: number): `${number}%` {
  return `${bpPercent1(Math.max(0, Math.min(10_000, pressedBp)))}%` as `${number}%`;
}
