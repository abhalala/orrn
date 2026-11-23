import { parseQtyMilli, type QtyProblem, type StoreUnit } from "@/features/store/store-qty";

export type LevelsDraft = { min: string; reorder: string };

export type LevelsInput =
  | { ok: true; minMilli: number | null; reorderMilli: number | null }
  | { ok: false; min?: QtyProblem; reorder?: QtyProblem };

/** An empty box clears the level (null); anything else must be a valid quantity for the item's unit. */
export function levelsInput(draft: LevelsDraft, unit: StoreUnit): LevelsInput {
  const read = (text: string) => {
    if (text.trim() === "") return { milli: null as number | null };
    const r = parseQtyMilli(text, unit);
    return r.ok ? { milli: r.milli } : { problem: r.problem };
  };
  const min = read(draft.min);
  const reorder = read(draft.reorder);
  if ("problem" in min || "problem" in reorder) {
    return { ok: false, min: "problem" in min ? min.problem : undefined, reorder: "problem" in reorder ? reorder.problem : undefined };
  }
  return { ok: true, minMilli: min.milli, reorderMilli: reorder.milli };
}
