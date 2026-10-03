import type { Translate } from "@orrn/i18n";
import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type ChartTableColumn = {
  key: string;
  header: string;
  /** Right-aligned mono figures. */
  numeric?: boolean;
};

export type ChartTableRow = Record<string, ReactNode>;

export type ChartTableData = { columns: ChartTableColumn[]; rows: ChartTableRow[] };

export type ChartTableProps = ChartTableData & {
  /** Names the table (the chart's title). */
  caption: string;
  className?: string;
};

/**
 * The table twin of every chart: the WCAG-clean way to read the same
 * numbers without hovering. Real `<th scope>` headers; the first column is
 * the row header. Scrolls sideways inside itself on narrow screens (the page
 * never does), and the scroller is focusable so keyboard users can scroll it.
 */
export function ChartTable({ columns, rows, caption, className }: ChartTableProps) {
  const [first, ...rest] = columns;
  return (
    <div
      data-slot="chart-table"
      role="region"
      aria-label={caption}
      tabIndex={0}
      className={cn("orrn-data-table-scroll max-w-full overflow-x-auto rounded-input", className)}
    >
      <table className="w-full border-collapse text-[14px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
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
                <th scope="row" className="py-2 pr-3 text-left font-medium">
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
  );
}

/* -------------------------------------------------------------------------- */
/* Table builders: the table comes from the same data and formatters          */
/* -------------------------------------------------------------------------- */

type SeriesLike = { key: string; label: string; points: { t: Date; v: number }[] };

/** One row per date, one column per series. Missing values read "No data". */
export function timeSeriesTable(
  series: readonly SeriesLike[],
  opts: { format(v: number): string; formatDate(d: Date): string; dateHeader: string; noValue: string },
): ChartTableData {
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => p.t.getTime())))].sort((a, b) => a - b);
  const lookup = series.map((s) => new Map(s.points.map((p) => [p.t.getTime(), p.v])));
  return {
    columns: [{ key: "date", header: opts.dateHeader }, ...series.map((s) => ({ key: s.key, header: s.label, numeric: true }))],
    rows: times.map((t) => {
      const row: ChartTableRow = { date: opts.formatDate(new Date(t)) };
      series.forEach((s, i) => {
        const v = lookup[i]!.get(t);
        row[s.key] = v === undefined ? opts.noValue : opts.format(v);
      });
      return row;
    }),
  };
}

/** One row per bar. */
export function barTable(
  data: readonly { key: string; label: string; value: number }[],
  opts: { format(v: number): string; labelHeader: string; valueHeader: string },
): ChartTableData {
  return {
    columns: [
      { key: "label", header: opts.labelHeader },
      { key: "value", header: opts.valueHeader, numeric: true },
    ],
    rows: data.map((d) => ({ label: d.label, value: opts.format(d.value) })),
  };
}

type RankedLike = { key: string; label: string; value: number; share?: number; movement?: number | null };

/** Words for a rank movement: "Up 2", "Down 1", "Same", "New". */
export function movementText(t: Translate, movement: number | null | undefined, long = false): string {
  if (movement === null) return t(long ? "charts.isNewLong" : "charts.isNew");
  if (movement === undefined || movement === 0) return t(long ? "charts.noChangeLong" : "charts.noChange");
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
  opts: { t: Translate; format(v: number): string; valueHeader: string; other?: number },
): ChartTableData {
  const { t } = opts;
  const hasShare = rows.some((r) => r.share !== undefined);
  const hasMovement = rows.some((r) => r.movement !== undefined);
  const columns: ChartTableColumn[] = [
    { key: "name", header: t("charts.name") },
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
    out.push({ name: t("charts.other"), rank: "", value: opts.format(opts.other), share: "", movement: "" });
  }
  return { columns, rows: out };
}
