import { useT } from "@orrn/i18n";
import { Table2 } from "lucide-react";
import { useId, useState, type HTMLAttributes, type ReactNode } from "react";

import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { cn } from "@orrn/ui/lib/utils";

import { ChartTable, type ChartTableData } from "./chart-table";
import { seriesLegend } from "./scales";

/**
 * The legend is derived from the series and the same colour domain the chart
 * uses (`seriesLegend`), so a swatch always matches its line by key. Callers
 * can't pass colours by position.
 */
export type ChartLegend = {
  series: { key: string; label: string }[];
  /** The chart's `colorDomain`, when it has one. */
  colorDomain?: string[];
  /** Mirrors the mark: a short line for lines, a square for bars and areas. */
  shape?: "line" | "square";
};

export type ChartCardProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  title: string;
  /** What is plotted and in which unit, e.g. "kg dispatched per month". */
  subtitle?: string;
  /**
   * A range control (SegmentedControl) that scopes this card and nothing
   * outside it. When the same period also scopes a list or other charts,
   * put the control in one row above all of them instead.
   */
  controls?: ReactNode;
  /** Shown for two or more series only: a single series is named by the title. */
  legend?: ChartLegend;
  /** The same numbers as the chart, for the "Show table" view. Build it with the table builders. */
  table: ChartTableData;
  state?: "loading" | "empty" | "error";
  /** A refetch is in flight: keep the previous chart at reduced opacity, no skeleton flash. */
  refreshing?: boolean;
  /** One action for the empty state, e.g. a longer period. */
  emptyAction?: ReactNode;
  onRetry?: () => void;
  /** Heading level of the title in the page outline. Default 3. */
  level?: 2 | 3 | 4;
  /** Plot height, so loading and empty states keep the card's size. Default 240. */
  plotHeight?: number;
  children: ReactNode;
};

/**
 * The frame every chart sits in: title and subtitle, the table toggle, an
 * optional range control, the legend (two or more series), then the plot
 * or its table. Loading keeps the plot's shape (skeleton), empty invites
 * the next step, error says what happened and offers Try again.
 *
 * Every chart must sit in a ChartCard: its table view is the fallback for
 * the categorical slots under 3:1 and for end labels dropped on phones.
 * Gate it on the screen with `<Can do="analytics.view">`: charts are for
 * owners and managers, not the floor (analytics addendum A1).
 */
export function ChartCard({
  title,
  subtitle,
  controls,
  legend,
  table,
  state,
  refreshing = false,
  emptyAction,
  onRetry,
  level = 3,
  plotHeight = 240,
  children,
  className,
  ...rest
}: ChartCardProps) {
  const { t } = useT();
  const titleId = useId();
  const bodyId = useId();
  const [showTable, setShowTable] = useState(false);
  const Heading = `h${level}` as const;
  const ready = state === undefined;

  return (
    <div
      data-slot="chart-card"
      data-chart-kit=""
      role="group"
      aria-labelledby={titleId}
      aria-busy={state === "loading" || refreshing ? true : undefined}
      className={cn("flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5", className)}
      {...rest}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={titleId} className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
            {title}
          </Heading>
          {subtitle ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {ready ? (
          <Button
            variant="ghost"
            className="-mt-1.5 -mr-2 shrink-0 px-3 text-[14px]"
            aria-expanded={showTable}
            aria-controls={bodyId}
            onClick={() => setShowTable((v) => !v)}
          >
            <Table2 aria-hidden="true" strokeWidth={2} />
            {showTable ? t("charts.hideTable") : t("charts.showTable")}
          </Button>
        ) : null}
      </div>

      {controls ? <div className="flex min-w-0 flex-wrap items-center gap-3">{controls}</div> : null}

      {ready && !showTable && legend && legend.series.length >= 2 ? (
        <ul aria-label={t("charts.legend")} className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0">
          {seriesLegend(legend.series, legend.colorDomain).map((item) => (
            <li key={item.key} className="flex items-center gap-2 text-[13px] leading-5">
              <span
                aria-hidden="true"
                data-slot="legend-swatch"
                data-series={item.key}
                className={cn("shrink-0", legend.shape === "square" ? "size-2.5 rounded-[3px]" : "h-0.5 w-3.5 rounded-full")}
                style={{ background: item.color }}
              />
              {item.label}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        id={bodyId}
        className={cn("min-w-0 transition-opacity duration-[var(--dur-base)]", refreshing && ready && "opacity-60")}
      >
        {state === "loading" ? (
          <div style={{ height: plotHeight }} className="flex flex-col justify-end gap-3">
            <span className="sr-only">{t("charts.loading")}</span>
            <Skeleton className="h-full w-full rounded-input" />
          </div>
        ) : state === "empty" ? (
          <EmptyState
            className="py-8"
            title={t("charts.emptyTitle")}
            body={t("charts.emptyBody")}
            action={emptyAction}
          />
        ) : state === "error" ? (
          <EmptyState
            className="py-8"
            title={t("charts.errorTitle")}
            body={t("charts.errorBody")}
            action={
              onRetry ? (
                <Button variant="secondary" onClick={onRetry}>
                  {t("common.retry")}
                </Button>
              ) : undefined
            }
          />
        ) : showTable ? (
          <ChartTable caption={title} columns={table.columns} rows={table.rows} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
