import { percentToPpm, type SpectroElementKey } from "@orrn/domain";

import { ppmPct } from "./model";

/** The typical chemistry master: ppm stored, percent shown and typed. Pure: no React. */

export type PpmMap = Partial<Record<SpectroElementKey, number | null>>;
export type ChemistryDraft = Partial<Record<SpectroElementKey, string>>;

/** Stored ppm to the typed percent text of each box ("0.450"); an element with no figure is blank. */
export function chemistryDraft(ppm: PpmMap | null | undefined, elements: readonly SpectroElementKey[]): ChemistryDraft {
  const out: ChemistryDraft = {};
  for (const el of elements) {
    const v = ppm?.[el];
    out[el] = v == null ? "" : ppmPct(v);
  }
  return out;
}

/** Typed percent per element to the `ppm` of `setChemistry`: blank clears (null), an unreadable box is named. */
export function chemistryPayload(draft: ChemistryDraft, elements: readonly SpectroElementKey[]): { ok: true; ppm: Record<string, number | null> } | { ok: false; element: SpectroElementKey } {
  const ppm: Record<string, number | null> = {};
  for (const el of elements) {
    const raw = (draft[el] ?? "").trim().replace(",", ".");
    if (raw === "") {
      ppm[el] = null;
      continue;
    }
    const v = percentToPpm(raw);
    if (v === null || v > 1_000_000) return { ok: false, element: el };
    ppm[el] = v;
  }
  return { ok: true, ppm };
}

/** How many elements a row has a figure for (the list says "5 of 9 set"). */
export const setCount = (ppm: PpmMap | null | undefined): number => Object.values(ppm ?? {}).filter((v) => v != null).length;
