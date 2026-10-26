import { formatKg } from "@orrn/domain";

/**
 * What the packing-bay scale is doing, from `scale.reading` (FP-PK-02). The server has already
 * applied the stability rule (five frames within 20 g, steady for 1 s, nothing older than 3 s, a
 * steady 0 is not a weight); this only names the state for the screen.
 *
 * - `off`: no scale is connected. A typed weight needs no reason.
 * - `silent`: a scale is set up but nothing is arriving (indicator off, node unreachable).
 * - `waiting`: frames are arriving but the weight is not steady yet.
 * - `stable`: a steady weight in grams. This is the only value that may fill the weight field.
 */
export type ScaleReadingLike = {
  stable: boolean;
  grams?: number;
  ageMs?: number;
  reason?: string;
  configured: boolean;
  simulated: boolean;
  nodeId: string | null;
};

export type ScaleView =
  | { state: "off" }
  | { state: "silent"; simulated: boolean }
  | { state: "waiting"; simulated: boolean; grams: number | null }
  | { state: "stable"; simulated: boolean; grams: number };

const SILENT_REASONS = new Set(["no_frames", "stale", "unreachable", "node_inactive", "bad_answer"]);

export function scaleView(reading: ScaleReadingLike | null | undefined): ScaleView {
  if (!reading || !reading.configured) return { state: "off" };
  if (reading.stable && typeof reading.grams === "number" && reading.grams > 0) {
    return { state: "stable", simulated: reading.simulated, grams: reading.grams };
  }
  if (reading.reason && SILENT_REASONS.has(reading.reason)) return { state: "silent", simulated: reading.simulated };
  return {
    state: "waiting",
    simulated: reading.simulated,
    grams: typeof reading.grams === "number" && reading.grams > 0 ? reading.grams : null,
  };
}

/** A typed weight asks a reason whenever a scale is connected (D12). */
export function typedWeightNeedsReason(view: ScaleView): boolean {
  return view.state !== "off";
}

/** How long to wait before asking again: quick while a scale is there, lazy when there is none. */
export function scalePollMs(view: ScaleView | null): number {
  if (view === null) return 800;
  return view.state === "off" ? 20_000 : 800;
}

/** Grams to the weight field's text: "52.4" (kg, no grouping, no trailing zeros). */
export function gramsToFieldText(grams: number): string {
  return String(Number((grams / 1000).toFixed(3)));
}

/** "52.40" for the chip beside the field. */
export function gramsToKgText(grams: number): string {
  return formatKg(grams / 1000, 2);
}

/**
 * Where a weight came from, for `createReceipt`: the field still holds exactly the steady scale
 * weight it was filled with, so it is `scale`; anything else is typed (`manual`) and carries the
 * last steady reading as evidence.
 */
export function weightProvenance(input: {
  weightG: number;
  filledFromG: number | null;
  lastStableG: number | null;
}): { weightSource: "scale" | "manual"; scaleReadingG?: number } {
  if (input.filledFromG !== null && input.filledFromG === input.weightG) {
    return { weightSource: "scale", scaleReadingG: input.filledFromG };
  }
  return { weightSource: "manual", ...(input.lastStableG ? { scaleReadingG: input.lastStableG } : {}) };
}
