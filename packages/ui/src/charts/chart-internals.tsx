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

type Active = { index: number; via: "pointer" | "focus"; focusVisible: boolean };

/**
 * One tab stop per plot (roving tabindex), starting on the newest mark.
 * Right/Up go to the next mark in x order, Left/Down to the previous,
 * Home/End to the ends, PageUp/PageDown seven at a time, Escape hides the
 * tooltip. Hover shows the same tooltip as focus.
 */
export function useRovingMarks(count: number, slot: string) {
  const [active, setActive] = useState<Active | null>(null);
  const [roving, setRoving] = useState<number | null>(null);
  const [hidden, setHidden] = useState(false);
  const focusIndex = Math.max(0, Math.min(roving ?? count - 1, count - 1));

  const move = (to: number, el: Element | null) => {
    const i = Math.max(0, Math.min(count - 1, to));
    setRoving(i);
    el?.closest("svg")?.querySelectorAll<SVGElement>(`[data-slot='${slot}']`)[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<SVGElement>, i: number) => {
    const keys: Record<string, number> = {
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
    if (e.key in keys) {
      e.preventDefault();
      move(keys[e.key]!, e.currentTarget);
    }
  };

  const markProps = (i: number) => ({
    "data-slot": slot,
    tabIndex: i === focusIndex ? 0 : -1,
    onPointerEnter: () => {
      setHidden(false);
      setActive({ index: i, via: "pointer", focusVisible: false });
    },
    onFocus: (e: FocusEvent<SVGElement>) => {
      setHidden(false);
      setRoving(i);
      setActive({ index: i, via: "focus", focusVisible: e.currentTarget.matches(":focus-visible") });
    },
    onBlur: () => setActive((a) => (a?.via === "focus" ? null : a)),
    onKeyDown: (e: KeyboardEvent<SVGElement>) => onKeyDown(e, i),
  });

  return {
    /** Index whose tooltip and crosshair show, or null. */
    show: active && !hidden ? active.index : null,
    /** Keyboard focus is on a mark and should be drawn. */
    focusVisible: !!active && active.via === "focus" && active.focusVisible,
    markProps,
    onPointerLeave: () => setActive((a) => (a?.via === "pointer" ? null : a)),
  };
}
