import { ppmPct } from "./model";
import { kgToG } from "./melt-form";

/** Figures and words of the "Suggest a mix" panel. Display only: nothing here fills a melt. */

export type MixStatus = "ok" | "outside_limits" | "short_metal" | "no_sources";
export type MixLine = { key: string; kind: "lot" | "stream"; label: string; kgG: number };
export type MixPredicted = { element: string; ppm: number; minPpm: number | null; maxPpm: number | null; ok: boolean };

export const MIX_STATUS_TONE: Record<MixStatus, "green" | "amber" | "red" | "neutral"> = { ok: "green", outside_limits: "amber", short_metal: "red", no_sources: "neutral" };

/** The target typed in the panel to grams the server takes (1 to 100,000 kg), null otherwise. */
export function targetG(text: string): number | null {
  const g = kgToG(text);
  return g !== null && g >= 1_000 && g <= 100_000_000 ? g : null;
}

/** The mix lines with their share of the charge in basis points, heaviest first. Zero-weight lines are dropped. */
export function mixRows(lines: readonly MixLine[]): (MixLine & { shareBp: number })[] {
  const live = lines.filter((l) => l.kgG > 0);
  const total = live.reduce((t, l) => t + l.kgG, 0);
  return live.map((l) => ({ ...l, shareBp: total > 0 ? Math.round((l.kgG * 10_000) / total) : 0 })).sort((a, b) => b.kgG - a.kgG || a.label.localeCompare(b.label));
}

/** 2,534 bp -> "25.3". */
export const shareText = (bp: number): string => (bp / 100).toFixed(1);

export type PredictedRow = { element: string; pct: string; limit: string; ok: boolean };
/** Predicted chemistry as percent next to the limit, in the alloy's element order. */
export function predictedRows(predicted: readonly MixPredicted[], words: { max: string; min: string; to: string }): PredictedRow[] {
  return predicted.map((p) => ({
    element: p.element,
    pct: ppmPct(p.ppm),
    limit: p.minPpm != null && p.maxPpm != null ? `${(p.minPpm / 10_000).toFixed(2)} ${words.to} ${(p.maxPpm / 10_000).toFixed(2)}` : p.maxPpm != null ? `${words.max} ${(p.maxPpm / 10_000).toFixed(2)}` : p.minPpm != null ? `${words.min} ${(p.minPpm / 10_000).toFixed(2)}` : "",
    ok: p.ok,
  }));
}

/** Elements outside their limits, for the "closest mix" sentence. */
export const outsideElements = (predicted: readonly MixPredicted[]): string[] => predicted.filter((p) => !p.ok).map((p) => p.element);

/** The cost line shows only when the server sent a figure (people who read purchase figures); null hides it. */
export const showsCost = (costPaise: number | null | undefined): costPaise is number => costPaise !== null && costPaise !== undefined;
