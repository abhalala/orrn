/**
 * Shared internals of the plotted charts (TimeSeriesChart, BarChart): the
 * y axis with its gridlines, x tick labels, and the roving hit-layer state
 * (hover, focus, keyboard). Not exported from the kit.
 */
import { formatAxisTicksIN } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useCallback, useState, type FocusEvent, type KeyboardEvent } from "react";

import { estimateTextWidth, valueScale } from "./scales";

export const TICK_FONT = 12;

/** Default y tick text: one compact en-IN unit for the whole axis, suffixes from i18n. */
export function useAxisTickFormatter() {
  const { t, locale } = useT();
  return useCallback(
    (ticks: number[]) =>
      formatAxisTicksIN(ticks, locale, {
        thousand: t("charts.unitThousand"),
        lakh: t("charts.unitLakh"),
        crore: t("charts.unitCrore"),
      }),
    [t, locale],
  );
}

/** y scale from zero, its ticks and their labels, and the left margin they need. */
export function useYAxis(peak: number, plotH: number, formatTicks?: (ticks: number[]) => string[]) {
  const fallback = useAxisTickFormatter();
  const { scale, ticks } = valueScale(peak, plotH);
  const labels = (formatTicks ?? fallback)(ticks);
  const left = Math.max(...labels.map((l) => estimateTextWidth(l, TICK_FONT, true)), 8) + 10;
  return { y: scale, ticks, labels, left };
}

/** Hairline gridlines, the baseline, and the tick labels. Decorative: the marks carry the values. */
export function YAxis({
  ticks,
  labels,
  y,
  plotW,
}: {
  ticks: number[];
  labels: string[];
  y: (v: number) => number;
  plotW: number;
}) {
  return (
    <g aria-hidden="true">
      {ticks.map((v, i) => (
        <g key={v} transform={`translate(0,${y(v)})`}>
          <line
            x2={plotW}
            stroke={v === 0 ? "var(--chart-axis)" : "var(--chart-grid)"}
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
          <text
            data-slot="chart-y-tick"
            x={-10}
            dy="0.32em"
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[12px] tabular-nums"
          >
            {labels[i]}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * x tick labels under the plot. A label that would poke past the chart box
 * anchors to its start or end instead of being clipped.
 */
export function XTicks({
  items,
  plotH,
  minX,
  maxX,
}: {
  items: { key: string | number; x: number; text: string }[];
  plotH: number;
  minX: number;
  maxX: number;
}) {
  return (
    <g aria-hidden="true">
      {items.map(({ key, x, text }) => {
        const w = estimateTextWidth(text, TICK_FONT);
        const anchor = x - w / 2 < minX ? "start" : x + w / 2 > maxX ? "end" : "middle";
        return (
          <text
            key={key}
            data-slot="chart-x-tick"
            x={anchor === "start" ? Math.max(x - w / 2, minX) : anchor === "end" ? Math.min(x + w / 2, maxX) : x}
            y={plotH + 18}
            textAnchor={anchor}
            className="fill-muted-foreground text-[12px]"
          >
            {text}
          </text>
        );
      })}
    </g>
  );
}

export type MarkKey = string | number;
type Tip = { key: MarkKey; via: "pointer" | "focus" };

/**
 * One tab stop per plot (roving tabindex), starting on the newest mark.
 * Right/Up go to the next mark in x order, Left/Down to the previous,
 * Home/End to the ends, PageUp/PageDown seven at a time, Escape hides the
 * tooltip. Hover shows the same tooltip as focus.
 *
 * State is held by mark key, never by index, so new data can't point past
 * the end (a range switch that drops marks under a resting pointer or a
 * focused mark): a mark that is gone shows nothing, a mark that survives
 * keeps its tooltip and focus at its new place, and a pointer tooltip is
 * dropped when the set of marks changes (the pointer now rests on another
 * mark; the next move shows it). Keyboard focus is tracked apart from the
 * tooltip: Escape and hovering elsewhere change the tooltip, never the
 * focus indicator.
 */
export function useRovingMarks(keys: readonly MarkKey[], slot: string) {
  const count = keys.length;
  const [tip, setTip] = useState<Tip | null>(null);
  const [focused, setFocused] = useState<{ key: MarkKey; visible: boolean } | null>(null);
  const [roving, setRoving] = useState<MarkKey | null>(null);
  const [hidden, setHidden] = useState(false);

  const signature = keys.join("\u0000");
  const [seen, setSeen] = useState(signature);
  if (seen !== signature) {
    setSeen(signature);
    setTip((t) => (t?.via === "pointer" ? null : t));
  }

  const indexOf = (key: MarkKey | null | undefined) => {
    if (key === null || key === undefined) return null;
    const i = keys.indexOf(key);
    return i === -1 ? null : i;
  };
  const focusIndex = indexOf(roving) ?? count - 1;

  const move = (to: number, el: Element | null) => {
    const i = Math.max(0, Math.min(count - 1, to));
    setRoving(keys[i] ?? null);
    el?.closest("svg")?.querySelectorAll<SVGElement>(`[data-slot='${slot}']`)[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<SVGElement>, i: number) => {
    const moves: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowUp: i + 1,
      ArrowLeft: i - 1,
      ArrowDown: i - 1,
      Home: 0,
      End: count - 1,
      PageUp: i + 7,
      PageDown: i - 7,
    };
    if (e.key === "Escape") {
      setHidden(true);
      return;
    }
    if (e.key in moves) {
      e.preventDefault();
      move(moves[e.key]!, e.currentTarget);
    }
  };

  const markProps = (i: number) => {
    const key = keys[i]!;
    return {
      "data-slot": slot,
      tabIndex: i === focusIndex ? 0 : -1,
      onPointerEnter: () => {
        setHidden(false);
        setTip({ key, via: "pointer" });
      },
      onFocus: (e: FocusEvent<SVGElement>) => {
        setHidden(false);
        setRoving(key);
        setFocused({ key, visible: e.currentTarget.matches(":focus-visible") });
        setTip({ key, via: "focus" });
      },
      onBlur: () => {
        setFocused((f) => (f?.key === key ? null : f));
        setTip((t) => (t?.via === "focus" ? null : t));
      },
      onKeyDown: (e: KeyboardEvent<SVGElement>) => onKeyDown(e, i),
    };
  };

  return {
    /** Index whose tooltip and crosshair show, or null. Always inside the current marks. */
    show: tip && !hidden ? indexOf(tip.key) : null,
    /** Index of the mark with visible keyboard focus, or null. Unaffected by Escape and hover. */
    focusRing: focused?.visible ? indexOf(focused.key) : null,
    markProps,
    onPointerLeave: () => setTip((t) => (t?.via === "pointer" ? null : t)),
  };
}
