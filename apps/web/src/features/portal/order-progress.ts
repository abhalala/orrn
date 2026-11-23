/**
 * XE parity REG #32: the party's "where is my order" line. `portal.orders.get` gives each line's kg by
 * stage; this picks the stages that hold kg, in plant order, for the line under the figures.
 */
export const PROGRESS_STAGES = ["notPlanned", "planned", "onPress", "ageing", "unpacked", "packed", "dispatched"] as const;
export type ProgressStage = (typeof PROGRESS_STAGES)[number];

export type LineProgress = {
  stage: ProgressStage;
  notPlannedG: number;
  plannedG: number;
  onPressG: number;
  ageingG: number;
  unpackedG: number;
  packedG: number;
  dispatchedG: number;
};

/** Stages with kg in them, in plant order (not planned first, dispatched last). */
export function progressParts(p: LineProgress | null | undefined): { stage: ProgressStage; g: number }[] {
  if (!p) return [];
  return PROGRESS_STAGES.map((stage) => ({ stage, g: p[`${stage}G` as const] })).filter((x) => x.g > 0);
}
