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

/**
 * Legend entries for a set of series, coloured by the SAME slot assignment
 * the marks use, so a swatch always matches its line, also after filtering.
 */
export function seriesLegend(
  series: readonly { key: string; label: string }[],
  colorDomain?: readonly string[],
): { key: string; label: string; color: string }[] {
  const slots = assignSeriesSlots(
    series.map((s) => s.key),
    colorDomain,
  );
  return series.map((s) => ({ key: s.key, label: s.label, color: seriesColor(slots[s.key]!) }));
}

/** Keep the first `limit` rows (already sorted by the caller) and sum the rest into Other. */
export function foldToOther<T extends { value: number }>(rows: readonly T[], limit = CHART_MAX_SERIES) {
  const top = rows.slice(0, limit);
  const other = rows.slice(limit).reduce((sum, r) => sum + r.value, 0);
  return { rows: top, other };
}

/** Rectangle in chart-box pixels, for collision checks. */
export type Box = { left: number; top: number; right: number; bottom: number };

export function boxesOverlap(a: Box, b: Box, pad = 0): boolean {
  return a.left < b.right + pad && b.left < a.right + pad && a.top < b.bottom + pad && b.top < a.bottom + pad;
}

/** Does the segment (x0,y0)-(x1,y1) pass through `box` grown by `pad`? (Liang-Barsky clip.) */
export function segmentHitsBox(x0: number, y0: number, x1: number, y1: number, box: Box, pad = 0): boolean {
  const [l, r, t, b] = [box.left - pad, box.right + pad, box.top - pad, box.bottom + pad];
  const dx = x1 - x0;
  const dy = y1 - y0;
  let u0 = 0;
  let u1 = 1;
  for (const [p, q] of [
    [-dx, x0 - l],
    [dx, r - x0],
    [-dy, y0 - t],
    [dy, b - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const u = q / p;
    if (p < 0) u0 = Math.max(u0, u);
    else u1 = Math.min(u1, u);
    if (u0 > u1) return false;
  }
  return true;
}

/** A straight piece of a drawn line, for collision checks: x0, y0, x1, y1. */
export type Segment = readonly [number, number, number, number];

/** Shortest distance from a point to a box (0 inside it). */
export function distanceToBox(x: number, y: number, b: Box): number {
  return Math.hypot(Math.max(b.left - x, 0, x - b.right), Math.max(b.top - y, 0, y - b.bottom));
}

/* -------------------------------------------------------------------------- */
/* Direct end labels                                                           */
/* -------------------------------------------------------------------------- */

/** A line's end dot and the rendered width of its label. */
export type EndLabelEnd = { key: string; x: number; y: number; width: number };
/** Where a label goes: right-aligned at `x`, text baseline at `base`. */
export type EndLabelSpot = { key: string; x: number; base: number; box: Box };

/**
 * Baselines tried for an end label, relative to its dot, nearest first:
 * level with it (directly left), just above, just below, then 3px further
 * each way. All of them keep the label within `END_LABEL_REACH`.
 */
const END_LABEL_OFFSETS = [4.5, -10, 20, -13, 23] as const;
/** Gap between a label's end and its dot's centre. */
const END_LABEL_GAP = 8;
/** A label is read as a line's own only within this many px of that line's end dot... */
export const END_LABEL_REACH = 14;
/** ...and at least this much nearer to it than to any other end dot (dots that meet get no labels). */
export const END_LABEL_MARGIN = 8;

/**
 * Direct end labels, left of each end dot (level with it, just above or
 * just below), clear of every line (`segments`), dot and other label. A
 * label nudged further away detaches from its line, and labels beside dots
 * that meet can't be told apart (dataviz marks-and-anatomy: never stack end
 * labels). So if any label has no spot within `END_LABEL_REACH` of its own
 * dot and `END_LABEL_MARGIN` nearer to it than to every other end dot,
 * there are no end labels at all and the legend names the lines. Returns
 * the spots in `ends` order.
 */
export function placeEndLabels(
  ends: readonly EndLabelEnd[],
  segments: readonly Segment[],
  bounds: { top: number; bottom: number },
): EndLabelSpot[] | null {
  const dots: Box[] = ends.map((e) => ({ left: e.x - 6, right: e.x + 6, top: e.y - 6, bottom: e.y + 6 }));
  const placed: EndLabelSpot[] = [];
  for (const e of [...ends].sort((a, b) => a.y - b.y)) {
    const others = ends.filter((o) => o !== e);
    const spot = END_LABEL_OFFSETS.map((off) => {
      const base = e.y + off;
      const box: Box = { left: e.x - END_LABEL_GAP - e.width, right: e.x - END_LABEL_GAP, top: base - 12, bottom: base + 3 };
      return { base, box };
    }).find(({ box }) => {
      const own = distanceToBox(e.x, e.y, box);
      return (
        box.top >= bounds.top &&
        box.bottom <= bounds.bottom &&
        own <= END_LABEL_REACH &&
        others.every((o) => distanceToBox(o.x, o.y, box) >= own + END_LABEL_MARGIN) &&
        !segments.some(([x0, y0, x1, y1]) => segmentHitsBox(x0, y0, x1, y1, box, 3)) &&
        ![...dots, ...placed.map((p) => p.box)].some((b) => boxesOverlap(box, b))
      );
    });
    if (!spot) return null;
    placed.push({ key: e.key, x: e.x - END_LABEL_GAP, base: spot.base, box: spot.box });
  }
  const order = new Map(ends.map((e, i) => [e.key, i]));
  return placed.sort((a, b) => order.get(a.key)! - order.get(b.key)!);
}

/* -------------------------------------------------------------------------- */
/* Bar value (cap) labels                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Where a bar's value label goes, in plot coordinates (the plot starts at
 * x 0; the y-tick labels sit left of it). Centred on the bar when it fits;
 * otherwise it starts at the bar's left edge (first bars) or ends at its
 * right edge (last bars), so it never slides into the y-tick gutter or
 * past the chart.
 */
export function placeCapLabel({
  center,
  width,
  barLeft,
  barRight,
  plotRight,
}: {
  center: number;
  width: number;
  barLeft: number;
  barRight: number;
  plotRight: number;
}): { x: number; anchor: "start" | "middle" | "end"; left: number; right: number } {
  const left = center - width / 2;
  if (left < 0) {
    const x = Math.max(0, Math.min(barLeft, plotRight - width));
    return { x, anchor: "start", left: x, right: x + width };
  }
  if (left + width > plotRight) {
    const x = Math.min(plotRight, Math.max(barRight, width));
    return { x, anchor: "end", left: x - width, right: x };
  }
  return { x: center, anchor: "middle", left, right: left + width };
}

/**
 * Bars that carry a value label: every complete bar when all the labels fit,
 * else only the tallest complete one. An open (partial) bucket is never a
 * headline, and an empty bar never gets one: "0.0 kg" along the baseline is
 * noise the axis already says (a new company's year of empty months).
 */
export function capLabelIndices(bars: readonly { value: number; partial?: boolean }[], allFit: boolean): number[] {
  const complete = bars.filter((d) => !d.partial);
  const peak = maxOf(complete.map((d) => d.value));
  const peakIndex = bars.findIndex((d) => !d.partial && d.value === peak);
  return bars.flatMap((d, i) => (!d.partial && d.value !== 0 && (allFit || i === peakIndex) ? [i] : []));
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

/** Date text for one chart. Build it with `chartDateFormat`. */
export type ChartDateFormat = {
  /** Tooltips, table rows and accessible names ("Mar 2026", "12 Mar 2026"). */
  long(d: Date): string;
  /** Axis ticks ("Mar", "12 Mar"). */
  short(d: Date): string;
  /** Axis tick that carries the year ("Oct 25", "1 Oct 2025"), where the axis crosses into a new year. */
  shortWithYear?(d: Date): string;
  /** Calendar year in the chart's time zone ("2026"). */
  year?(d: Date): string;
};

/**
 * Date formatters for one chart: `long` for tooltips, table rows and
 * accessible names ("Mar 2026", "12 Mar 2026"), `short` for axis ticks
 * ("Mar", "12 Mar"), `shortWithYear` for the ticks that must carry the year
 * ("Oct 25" for months; "1 Oct 2025" for days, where a 2-digit year would
 * read as a day). Pass the same formatter to the chart and its table so
 * they always agree.
 */
export function chartDateFormat(
  granularity: DateGranularity,
  locale = "en",
  timeZone = "Asia/Kolkata",
): Required<ChartDateFormat> {
  const tag = chartLocaleTag(locale);
  const month = granularity === "month";
  const long = new Intl.DateTimeFormat(
    tag,
    month ? { month: "short", year: "numeric", timeZone } : { day: "numeric", month: "short", year: "numeric", timeZone },
  );
  const short = new Intl.DateTimeFormat(tag, month ? { month: "short", timeZone } : { day: "numeric", month: "short", timeZone });
  const withYear = month ? new Intl.DateTimeFormat(tag, { month: "short", year: "2-digit", timeZone }) : long;
  const year = new Intl.DateTimeFormat("en", { year: "numeric", timeZone });
  return {
    long: (d) => long.format(d),
    short: (d) => short.format(d),
    shortWithYear: (d) => withYear.format(d),
    year: (d) => year.format(d),
  };
}

/** Do these times fall in more than one calendar year (in the chart's time zone)? */
function spansYears(times: readonly number[], dates: ChartDateFormat): boolean {
  if (!dates.year || !dates.shortWithYear || times.length < 2) return false;
  const first = dates.year(new Date(times[0]!));
  return times.some((t) => dates.year!(new Date(t)) !== first);
}

/**
 * Text for the x ticks actually drawn (`times`, oldest first). When they
 * span more than one year, the first tick and the first tick of each new
 * year carry the year ("Oct 25 ... Jan 26 ... Oct"), so a 13-month axis
 * never shows two bare "Oct"s. Otherwise every tick is short.
 */
export function dateTickTexts(times: readonly number[], dates: ChartDateFormat): string[] {
  if (!spansYears(times, dates)) return times.map((t) => dates.short(new Date(t)));
  const years = times.map((t) => dates.year!(new Date(t)));
  return times.map((t, i) =>
    i === 0 || years[i] !== years[i - 1] ? dates.shortWithYear!(new Date(t)) : dates.short(new Date(t)),
  );
}

/** The widest x tick these dates could draw, for tick spacing (year ticks count when the data spans years). */
export function widestDateTick(times: readonly number[], dates: ChartDateFormat, fontSize: number): number {
  const withYear = spansYears(times, dates);
  return Math.max(
    0,
    ...times.map((t) => {
      const d = new Date(t);
      return estimateTextWidth(withYear ? dates.shortWithYear!(d) : dates.short(d), fontSize);
    }),
  );
}
