import type { LengthUnit } from "@orrn/domain";

import { parseBundleEntry, type BundleEntryErrors, type TypedBundle } from "./pack-form";
import type { DraftBundle } from "./pack-math";
import { typedWeightNeedsReason, weightProvenance, type ScaleView } from "./scale-view";

/**
 * The open bundle card (FP-PK-02, D12): one typed bundle to a saved one, with where its weight came from.
 * A steady scale weight that fills the field and stays as it is is `scale`. A weight typed over it, or
 * typed while a scale is connected, is `manual` with the last steady reading as evidence and needs a reason.
 * With no scale on the node, nothing about provenance is sent and no reason is asked (the server agrees).
 * Pure: the screen only shows what this decides.
 */
export type CardErrors = BundleEntryErrors & { reason?: true };

export function cardBundle(input: {
  key: string;
  unit: LengthUnit;
  typed: TypedBundle;
  scale: ScaleView;
  /** The steady grams the weight field was filled with, null when it was typed. */
  filledFromG: number | null;
  /** The last steady grams seen, kept as evidence when the packer types. */
  lastStableG: number | null;
  reason: string;
}): { ok: true; bundle: DraftBundle } | { ok: false; errors: CardErrors } {
  const entry = parseBundleEntry(input.unit, input.typed);
  const scaleOn = typedWeightNeedsReason(input.scale);
  const weightG = entry.ok ? entry.weightG : null;
  const filled = weightG !== null && input.filledFromG !== null && input.filledFromG === weightG;
  const needsWhy = scaleOn && weightG !== null && !filled;
  const reason = input.reason.trim();
  const errors: CardErrors = entry.ok ? {} : { ...entry.errors };
  if (needsWhy && !reason) errors.reason = true;
  if (!entry.ok || errors.reason) return { ok: false, errors };

  const prov = scaleOn ? weightProvenance({ weightG: entry.weightG, filledFromG: input.filledFromG, lastStableG: input.lastStableG }) : null;
  return {
    ok: true,
    bundle: {
      key: input.key,
      weightG: entry.weightG,
      pieces: entry.pieces,
      lengthMm: entry.lengthMm,
      po: entry.po,
      ...(prov ? { weightSource: prov.weightSource, ...(prov.scaleReadingG ? { scaleReadingG: prov.scaleReadingG } : {}) } : {}),
      ...(prov?.weightSource === "manual" && reason ? { weightOverrideReason: reason } : {}),
    },
  };
}

/** True when the card shows the "why did you type it" field: a scale is connected and the weight is not the steady reading. */
export function asksReason(scale: ScaleView, weightG: number | null, filledFromG: number | null): boolean {
  return typedWeightNeedsReason(scale) && weightG !== null && !(filledFromG !== null && filledFromG === weightG);
}

/** How many bundles of the session were typed (not weighed) while a scale was connected: the Review line. */
export function typedCount(bundles: readonly DraftBundle[]): number {
  return bundles.filter((b) => b.weightSource === "manual").length;
}
