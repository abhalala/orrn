import type { Translate } from "@orrn/i18n";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type ChartTableColumn = {
  key: string;
  header: string;
  /** Right-aligned mono figures. */
  numeric?: boolean;
  /**
   * Narrowest the column may get, in rem. For name columns: on a phone the
   * figures never wrap, so without it a long name breaks one word a line;
   * with it the table scrolls sideways instead (the edge fade says so).
   */
  minRem?: number;
};

export type ChartTableRow = Record<string, ReactNode>;

export type ChartTableData = { columns: ChartTableColumn[]; rows: ChartTableRow[] };

export type ChartTableProps = ChartTableData & {
  /** Names the table (the chart's title). */
  caption: string;
  className?: string;
};

/** Which sides of a sideways scroller hide content. */
export type ScrollEdges = { start: boolean; end: boolean };

/**
 * Which sides of a sideways scroller hide content. Within a pixel of an edge
 * counts as the edge (zoomed and high-density screens scroll in fractions).
 */
export function scrollEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): ScrollEdges {
  const max = el.scrollWidth - el.clientWidth;
  return { start: el.scrollLeft > 1, end: el.scrollLeft < max - 1 };
}

/** Tracks `scrollEdges` of a scroller through scrolls, resizes and content changes. */
function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = scrollEdges(el);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);
  return [ref, edges] as const;
}

/**
 * The cue on the side that hides columns (AN-2 UX m5): a soft ink shadow at
 * the very edge (dark on light, light on dark, so it reads in both themes)
 * over a card-coloured fade of the text beneath it. Laid over the scroller
 * rather than masking it: a mask would also clip the scroller's focus ring.
 */
function EdgeFade({ side }: { side: "start" | "end" }) {
  const toward = side === "start" ? "right" : "left";
  return (
    <span
      aria-hidden="true"
      data-slot="chart-table-fade"
      data-side={side}
      className={cn("pointer-events-none absolute inset-y-0 w-10", side === "start" ? "left-0" : "right-0")}
      style={{
        background: [
          `linear-gradient(to ${toward}, color-mix(in oklab, var(--foreground) 16%, transparent), transparent 10px)`,
          `linear-gradient(to ${toward}, var(--card) 15%, transparent)`,
        ].join(", "),
      }}
    />
  );
}

const minWidth = (c: ChartTableColumn | undefined): CSSProperties | undefined =>
  c?.minRem ? { minWidth: `${c.minRem}rem` } : undefined;

/**
 * The table twin of every chart: the WCAG-clean way to read the same
 * numbers without hovering. Real `<th scope>` headers; the first column is
 * the row header. Scrolls sideways inside itself on narrow screens (the page
 * never does) with a fade on the side that hides columns, and the scroller is
 * focusable so keyboard users can scroll it. The fade is card-coloured: the
 * table lives inside a ChartCard.
 */
export function ChartTable({ columns, rows, caption, className }: ChartTableProps) {
  const [first, ...rest] = columns;
  const [scrollerRef, edges] = useScrollEdges<HTMLDivElement>();
  return (
    <div className={cn("relative min-w-0", className)}>
      <div
        ref={scrollerRef}
        data-slot="chart-table"
        data-hidden-start={edges.start ? "" : undefined}
        data-hidden-end={edges.end ? "" : undefined}
        role="region"
        aria-label={caption}
        tabIndex={0}
        className="orrn-data-table-scroll max-w-full overflow-x-auto rounded-input"
      >
        <table className="w-full border-collapse text-[14px]">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border">
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  style={minWidth(c)}
                  className={cn(
                    "px-3 py-2 text-[13px] font-semibold text-muted-foreground first:pl-0 last:pr-0",
                    c.numeric ? "text-right" : "text-left",
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-b-0">
                {first ? (
                  <th scope="row" className="py-2 pr-3 text-left font-medium" style={minWidth(first)}>
                    {row[first.key]}
                  </th>
                ) : null}
                {rest.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      "px-3 py-2 last:pr-0",
                      c.numeric && "text-right font-mono tabular-nums whitespace-nowrap",
                    )}
                  >
                    {row[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edges.start ? <EdgeFade side="start" /> : null}
      {edges.end ? <EdgeFade side="end" /> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Table builders: the table comes from the same data and formatters          */
/* -------------------------------------------------------------------------- */

type SeriesLike = { key: string; label: string; points: { t: Date; v: number; partial?: boolean }[] };

/** One row per date, one column per series. A partial (open) date reads "so far"; missing values "No data". */
export function timeSeriesTable(
  series: readonly SeriesLike[],
  opts: { t: Translate; format(v: number): string; formatDate(d: Date): string; dateHeader: string },
): ChartTableData {
  const { t } = opts;
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t.getTime())))].sort((a, b) => a - b);
  const lookup = series.map((s) => new Map(s.points.map((p) => [p.t.getTime(), p])));
  return {
    columns: [{ key: "date", header: opts.dateHeader }, ...series.map((s) => ({ key: s.key, header: s.label, numeric: true }))],
    rows: times.map((time) => {
      const date = opts.formatDate(new Date(time));
      const partial = lookup.some((m) => m.get(time)?.partial);
      const row: ChartTableRow = { date: partial ? t("charts.soFarLabel", { label: date }) : date };
      series.forEach((s, i) => {
        const p = lookup[i]!.get(time);
        row[s.key] = p === undefined ? t("charts.noValue") : opts.format(p.v);
      });
      return row;
    }),
  };
}

/** One row per bar. A partial (open) bucket reads "so far". */
export function barTable(
  data: readonly { key: string; label: string; value: number; partial?: boolean }[],
  opts: { t: Translate; format(v: number): string; labelHeader: string; valueHeader: string },
): ChartTableData {
  return {
    columns: [
      { key: "label", header: opts.labelHeader },
      { key: "value", header: opts.valueHeader, numeric: true },
    ],
    rows: data.map((d) => ({
      label: d.partial ? opts.t("charts.soFarLabel", { label: d.label }) : d.label,
      value: opts.format(d.value),
    })),
  };
}

type RankedLike = { key: string; label: string; value: number; share?: number; movement?: number | null };

/** Words for a rank movement: "Up 2", "Down 1", "Same", "New"; "No data" when it isn't known. */
export function movementText(t: Translate, movement: number | null | undefined, long = false): string {
  if (movement === undefined) return t("charts.noValue");
  if (movement === null) return t(long ? "charts.isNewLong" : "charts.isNew");
  if (movement === 0) return t(long ? "charts.noChangeLong" : "charts.noChange");
  const count = Math.abs(movement);
  if (movement > 0) return t(long ? "charts.movedUpLong" : "charts.movedUp", { count });
  return t(long ? "charts.movedDownLong" : "charts.movedDown", { count });
}

/** Share as a percent with one decimal ("24.5%"). `share` is 0-100. */
export function formatShare(share: number): string {
  return `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(share)}%`;
}

/** Rank, name, value, share and movement, plus the Other row last. */
export function rankedTable(
  rows: readonly RankedLike[],
  opts: { t: Translate; format(v: number): string; valueHeader: string; other?: number; otherLabel?: string },
): ChartTableData {
  const { t } = opts;
  const hasShare = rows.some((r) => r.share !== undefined);
  const hasMovement = rows.some((r) => r.movement !== undefined);
  const columns: ChartTableColumn[] = [
    { key: "name", header: t("charts.name"), minRem: 9 },
    { key: "rank", header: t("charts.rank"), numeric: true },
    { key: "value", header: opts.valueHeader, numeric: true },
  ];
  if (hasShare) columns.push({ key: "share", header: t("charts.share"), numeric: true });
  if (hasMovement) columns.push({ key: "movement", header: t("charts.movement") });
  const out: ChartTableRow[] = rows.map((r, i) => ({
    name: r.label,
    rank: String(i + 1),
    value: opts.format(r.value),
    share: r.share === undefined ? "" : formatShare(r.share),
    movement: movementText(t, r.movement),
  }));
  if (opts.other && opts.other > 0) {
    out.push({ name: opts.otherLabel ?? t("charts.other"), rank: "", value: opts.format(opts.other), share: "", movement: "" });
  }
  return { columns, rows: out };
}
