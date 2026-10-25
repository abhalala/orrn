/**
 * Press plan purpose on the plan board (FP-PR-23, BACKLOG 61). A production plan presses order
 * lines. A die trial, a sample or another run is a plan of one or more dies with NO order lines
 * (the server refuses lines on it and never moves baki for it). The press plan has no field for a
 * planned copy or quantity, so the planner's choice of copy and kg / pcs is kept in the plan note
 * for the die room and the press. Nothing here works out a figure the server owns.
 */
import type { CopyStatus } from "../die-room/die-room-model";
import { parsePieces, parseKgG } from "./line-model";

export const PLAN_PURPOSES = ["production", "die_trial", "sample", "other"] as const;
export type PlanPurpose = (typeof PLAN_PURPOSES)[number];

/** Anything but production: dies only, no order lines. */
export function isTrialPurpose(purpose: PlanPurpose): boolean {
  return purpose !== "production";
}

/**
 * Copies offered for the plan. A copy on trial goes only to a die trial run (FP-DR-17), so a die
 * trial offers just those; a sample or another run may use a rack copy or one on trial.
 */
export function copyStatusesFor(purpose: PlanPurpose): CopyStatus[] {
  if (purpose === "die_trial") return ["on_trial"];
  if (purpose === "production") return [];
  return ["available", "on_trial"];
}

type Quantity = { kgText: string; pcsText: string };

function kgLabel(kgG: number): string {
  return `${kgG / 1000} kg`;
}

/** "13090-11 · 500 kg · 120 pcs", or null when nothing was planned. */
export function trialPlanNote(d: Quantity & { copyCode: string | null }): string | null {
  const parts: string[] = [];
  if (d.copyCode) parts.push(d.copyCode);
  const kgG = parseKgG(d.kgText);
  if (kgG != null) parts.push(kgLabel(kgG));
  const pcs = parsePieces(d.pcsText);
  if (pcs != null) parts.push(`${pcs} pcs`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export type TrialProblems = { die?: true; kg?: true; pcs?: true };

/** A die is needed; a quantity that was typed has to be a real number. */
export function trialDraftProblems(d: Quantity & { sectionId: string }): TrialProblems {
  const out: TrialProblems = {};
  if (!d.sectionId) out.die = true;
  if (d.kgText.trim() !== "" && parseKgG(d.kgText) == null) out.kg = true;
  if (d.pcsText.trim() !== "" && parsePieces(d.pcsText) == null) out.pcs = true;
  return out;
}

/** The `plans.create` body of a non-production plan: one die, no order lines. */
export function trialPlanInput(d: Quantity & {
  purpose: Exclude<PlanPurpose, "production">;
  sectionId: string;
  copyCode: string | null;
  windowStart: number;
  windowEnd: number;
  pressLineId: string;
}) {
  const note = trialPlanNote(d);
  return {
    purpose: d.purpose,
    windowStart: d.windowStart,
    windowEnd: d.windowEnd,
    ...(d.pressLineId ? { pressLineId: d.pressLineId } : {}),
    ...(note ? { note } : {}),
    dies: [{ sectionId: d.sectionId, lines: [] as never[] }],
  };
}
