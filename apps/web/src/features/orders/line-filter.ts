/**
 * Line filters for a long order (FP-OP-05): from 20 lines on, the detail page can narrow its lines
 * by die, cut length, stage and "has baki", with the kg and pieces of the lines shown. Each line's
 * figures are the server's strip; this file only decides which lines are shown and adds up the
 * ordered kg / pieces of those lines (they are all on the page already).
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

export type FilterableStrip = {
  dispatchedG: number;
  inStockG: number;
  pressedG: number;
  plannedG: number;
  planableG: number;
  overG: number;
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

/** A line is in a stage when it has kg there (the server's strip: planable kg are the "not planned"). */
export function inStage(strip: FilterableStrip | undefined, stage: LineStage): boolean {
  if (!strip) return false;
  switch (stage) {
    case "dispatched":
      return strip.dispatchedG > 0;
    case "in_stock":
      return strip.inStockG > 0;
    case "pressed":
      return strip.pressedG > 0;
    case "planned":
      return strip.plannedG > 0;
    case "unplanned":
      return strip.planableG > 0;
    case "over":
      return strip.overG > 0;
  }
}

export function matchesLine(line: FilterableLine, strip: FilterableStrip | undefined, f: LineFilterState): boolean {
  if (f.die && line.sectionId !== f.die) return false;
  if (f.length && String(line.cutLengthMm) !== f.length) return false;
  if (f.hasBaki && !(line.bakiG > 0)) return false;
  if (f.stage && !inStage(strip, f.stage)) return false;
  return true;
}

export function filterLines<L extends FilterableLine>(lines: readonly L[], strips: ReadonlyMap<string, FilterableStrip>, f: LineFilterState): L[] {
  return lines.filter((l) => matchesLine(l, strips.get(l.lineId), f));
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

/** Pieces and kg of the lines shown (a line without a piece count adds none). */
export function shownTotals(lines: readonly Pick<FilterableLine, "orderedG" | "orderedPcs">[]): { lines: number; pcs: number; orderedG: number } {
  return lines.reduce((t, l) => ({ lines: t.lines + 1, pcs: t.pcs + (l.orderedPcs ?? 0), orderedG: t.orderedG + l.orderedG }), { lines: 0, pcs: 0, orderedG: 0 });
}
