/**
 * Pure helpers shared by the chart kit: colour slots, Other folding, scales,
 * tick picking and nearest-point lookup. No React, no DOM, so they are unit
 * tested in `palette.test.ts` and reusable by any later chart.
 */
import { bisector, max as d3max } from "d3-array";
import { scaleLinear } from "d3-scale";

/** Token ceiling of the categorical palette. A ninth series folds into "Other". */
export const CHART_MAX_SERIES = 8;

/** CSS colour for categorical slot `slot` (0-based). Never cycles past slot 8. */
export function seriesColor(slot: number): string {
  if (!Number.isInteger(slot) || slot < 0 || slot >= CHART_MAX_SERIES) {
    throw new Error(`Chart slot ${slot} doesn't exist: fold the tail into Other instead of cycling colours.`);
  }
  return `var(--chart-${slot + 1})`;
}

/** De-emphasis grey for "Other" and context marks. */
export const OTHER_COLOR = "var(--chart-other)";

/** Ordinal ramp colour for bucket `i` of `n` (age bands, tiers): low to high. */
export function ordinalColor(i: number, n: number): string {
  const steps = 5;
  if (n <= 1) return "var(--chart-ord-3)";
  const step = Math.round((i / (n - 1)) * (steps - 1)) + 1;
  return `var(--chart-ord-${Math.min(steps, Math.max(1, step))})`;
}

/**
 * Colour follows the entity, never its rank or position on screen. Pass the
 * stable `domain` (every key the screen can show, in a fixed order) and the
 * keys visible now; a survivor keeps its slot when others are filtered out.
 * Without a domain, the given order is the domain.
 */
export function assignSeriesSlots(keys: readonly string[], domain: readonly string[] = keys): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of keys) {
    const slot = domain.indexOf(key);
    if (slot === -1) throw new Error(`Series "${key}" is missing from the colour domain.`);
    if (slot >= CHART_MAX_SERIES) {
      throw new Error(`Series "${key}" is past slot ${CHART_MAX_SERIES}: fold it into Other.`);
    }
    out[key] = slot;
  }
  return out;
}

/** Keep the first `limit` rows (already sorted by the caller) and sum the rest into Other. */
export function foldToOther<T extends { value: number }>(rows: readonly T[], limit = CHART_MAX_SERIES) {
  const top = rows.slice(0, limit);
  const other = rows.slice(limit).reduce((sum, r) => sum + r.value, 0);
  return { rows: top, other };
}

/** A y scale from 0 to a nice maximum (magnitudes always start at zero). */
export function valueScale(maxValue: number, height: number, ticks = 4) {
  const top = maxValue > 0 ? maxValue : 1;
  const scale = scaleLinear().domain([0, top]).range([height, 0]).nice(ticks);
  return { scale, ticks: scale.ticks(ticks) };
}

/** The largest value across series (0 when empty). */
export function maxOf(values: readonly number[]): number {
  return d3max(values) ?? 0;
}

/**
 * Indices of the x labels to draw so none collide: every k-th point, always
 * keeping the last one (the most recent period is the one people look for).
 */
export function pickTickIndices(count: number, plotWidth: number, minSpacing: number): number[] {
  if (count <= 0) return [];
  const fit = Math.max(1, Math.floor(plotWidth / minSpacing));
  const step = Math.max(1, Math.ceil(count / fit));
  const out: number[] = [];
  // Walk back from the last point so the newest label is always present.
  for (let i = count - 1; i >= 0; i -= step) out.unshift(i);
  return out;
}

const byValue = bisector((d: number) => d).center;

/** Index of the value in a sorted array nearest to `x`. */
export function nearestIndex(sorted: readonly number[], x: number): number {
  if (sorted.length === 0) return -1;
  return Math.max(0, Math.min(sorted.length - 1, byValue(sorted as number[], x)));
}

/**
 * Rough rendered width of a label at `fontSize` px, a little generous so
 * labels never collide or clip. `mono` text (Geist Mono: figures, weights)
 * is 0.6em per character, punctuation included.
 */
export function estimateTextWidth(text: string, fontSize = 12, mono = false): number {
  let w = 0;
  for (const ch of text) {
    if (mono) w += 0.62;
    else w += /[0-9]/.test(ch) ? 0.6 : /[ .,:]/.test(ch) ? 0.3 : /[A-Z]/.test(ch) ? 0.68 : 0.56;
  }
  return Math.ceil(w * fontSize);
}

/* -------------------------------------------------------------------------- */
/* Dates (company timezone, IST by default)                                   */
/* -------------------------------------------------------------------------- */

export type DateGranularity = "day" | "month";

/** Monthly buckets when points sit about a month apart, else daily. */
export function detectGranularity(times: readonly number[]): DateGranularity {
  if (times.length < 2) return "day";
  const gaps = times.slice(1).map((t, i) => t - times[i]!).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  return median >= 27 * 86_400_000 ? "month" : "day";
}

/** BCP 47 tag for chart dates: Indian English, or Hindi. */
export function chartLocaleTag(locale: string): string {
  return locale === "hi" ? "hi-IN" : "en-IN";
}

/**
 * Date formatters for one chart: `long` for tooltips, table rows and
 * accessible names ("Mar 2026", "12 Mar 2026"), `short` for axis ticks
 * ("Mar", "12 Mar"). Pass the same pair to the chart and its table so they
 * always agree.
 */
export function chartDateFormat(granularity: DateGranularity, locale = "en", timeZone = "Asia/Kolkata") {
  const tag = chartLocaleTag(locale);
  const long = new Intl.DateTimeFormat(
    tag,
    granularity === "month"
      ? { month: "short", year: "numeric", timeZone }
      : { day: "numeric", month: "short", year: "numeric", timeZone },
  );
  const short = new Intl.DateTimeFormat(
    tag,
    granularity === "month" ? { month: "short", timeZone } : { day: "numeric", month: "short", timeZone },
  );
  return { long: (d: Date) => long.format(d), short: (d: Date) => short.format(d) };
}
