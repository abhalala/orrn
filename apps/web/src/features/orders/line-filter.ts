/**
 * Line filters for a long order (FP-OP-05): from 20 lines on, the detail page can narrow its lines
 * by die, cut length, stage and "has baki", with the kg and pieces of the lines shown. The server
 * (`orders.get` `lineFilter` -> `shown`) picks the lines and totals them; this file only turns the
 * choices into that input and offers the dies and lengths the order has.
 */
import { dieTitle } from "./view";

export const LINE_FILTER_FROM = 20;

export const LINE_STAGES = ["dispatched", "in_stock", "pressed", "planned", "unplanned", "over"] as const;
export type LineStage = (typeof LINE_STAGES)[number];

export type FilterableLine = {
  lineId: string;
  sectionId: string;
  sectionCode: string;
  sectionName: string | null;
  series: string;
  cutLengthMm: number;
  orderedG: number;
  orderedPcs: number | null;
  bakiG: number;
};

export type LineFilterState = { die: string; length: string; stage: LineStage | ""; hasBaki: boolean };

export const NO_LINE_FILTER: LineFilterState = { die: "", length: "", stage: "", hasBaki: false };

export function lineFilterActive(f: LineFilterState): boolean {
  return Boolean(f.die || f.length || f.stage || f.hasBaki);
}

/** Whether the filters are offered: only on orders with enough lines to need them. */
export function showLineFilters(lineCount: number): boolean {
  return lineCount >= LINE_FILTER_FROM;
}

/** The `orders.get` `lineFilter` for these choices: the server picks the lines and totals them (review r1 I-1). */
export function serverLineFilter(f: LineFilterState): { dieId?: string; cutLengthMm?: number; stage?: LineStage; hasBaki?: boolean } {
  const mm = Number(f.length);
  return {
    ...(f.die ? { dieId: f.die } : {}),
    ...(f.length && Number.isInteger(mm) && mm > 0 ? { cutLengthMm: mm } : {}),
    ...(f.stage ? { stage: f.stage } : {}),
    ...(f.hasBaki ? { hasBaki: true } : {}),
  };
}

/** The lines to show: the server's `shown.lineIds`, in the order's line order. */
export function shownOf<L extends { lineId: string }>(lines: readonly L[], shownIds: readonly string[] | undefined): L[] {
  if (!shownIds) return [...lines];
  const keep = new Set(shownIds);
  return lines.filter((l) => keep.has(l.lineId));
}

/** The dies and cut lengths the order has, for the two selects (each once, in line order). */
export function filterOptions(lines: readonly FilterableLine[]): { dies: { id: string; label: string }[]; lengths: number[] } {
  const dies = new Map<string, string>();
  const lengths = new Set<number>();
  for (const l of lines) {
    if (!dies.has(l.sectionId)) dies.set(l.sectionId, dieTitle({ sectionCode: l.sectionCode, sectionName: l.sectionName, series: l.series }));
    lengths.add(l.cutLengthMm);
  }
  return { dies: [...dies].map(([id, label]) => ({ id, label })), lengths: [...lengths].sort((a, b) => a - b) };
}
