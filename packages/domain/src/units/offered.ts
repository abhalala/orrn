/**
 * What a plant may choose in the first release (owner decision, 2026-11-10): weight in kg, tonne or lb;
 * length in feet and inches, mm or m; section weight in kg per 12 ft, kg per m or lb per ft. Number and date
 * style are free within the validator. Every other kind stays on its default until a later release.
 * The registry knows more units; this list is what a plant write accepts and what the Units tab offers.
 */
import type { Kind, UnitId } from "./registry";
import { ORRN_DEFAULT_PREFS, type PlantUnitSettings } from "./prefs";

export const PLANT_UNIT_CHOICES = {
  mass: ["kg", "t", "lb"],
  length: ["mm", "ft_in", "m"],
  linear_mass: ["kg_12ft", "kg_m", "lb_ft"],
} as const satisfies Partial<Record<Kind, readonly UnitId[]>>;

export type OfferedKind = keyof typeof PLANT_UNIT_CHOICES;
export const OFFERED_KINDS = Object.keys(PLANT_UNIT_CHOICES) as OfferedKind[];

/** Problems with a plant's `units` choice that the generic validator allows: a unit outside the first release. */
export function offeredUnitProblems(settings: PlantUnitSettings): string[] {
  const problems: string[] = [];
  for (const [kind, unit] of Object.entries(settings.units ?? {})) {
    const choices = (PLANT_UNIT_CHOICES as Record<string, readonly string[] | undefined>)[kind];
    const fallback = ORRN_DEFAULT_PREFS.units[kind as Kind];
    if (choices ? !choices.includes(unit) : unit !== fallback) problems.push(`${unit} is not offered for ${kind}`);
  }
  if (settings.lock?.length) problems.push("locking a unit is not offered yet");
  if (settings.documents) problems.push("document units are not offered yet");
  if (settings.precision) problems.push("precision is not offered yet");
  return problems;
}
