import { useT } from "@orrn/i18n";
import { ArrowDown, ArrowUp, Equal, Sparkle } from "lucide-react";

import { cn } from "@orrn/ui/lib/utils";

import { formatShare, movementText } from "./chart-table";
import { OTHER_COLOR, seriesColor } from "./scales";

export type RankedRow = {
  key: string;
  label: string;
  value: number;
  /** Share of the total, 0-100. */
  share?: number;
  /** Places moved since the previous period: + up, - down, 0 same, null new. Omit to hide. */
  movement?: number | null;
};

export type RankedBarsProps = {
  /** Already sorted, highest first; fold the tail with `foldToOther` and pass it as `other`. */
  rows: RankedRow[];
  format(v: number): string;
  /** The folded tail, drawn last in grey and never ranked. */
  other?: number;
  /** Accessible name of the list. */
  label?: string;
};

/**
 * Horizontal leaderboard bars: who is leading. One series, so every bar
 * wears slot 1 (rank is the length, not a colour) and "Other" wears the
 * de-emphasis grey. Every value is direct-labelled, so there is nothing a
 * tooltip would add; share and rank movement are written as text with an
 * icon (screen readers hear "Up 2 places from the previous period").
 */
export function RankedBars({ rows, format, other, label }: RankedBarsProps) {
  const { t } = useT();
  const otherValue = other && other > 0 ? other : 0;
  const peak = Math.max(...rows.map((r) => r.value), otherValue, 0) || 1;
  const all = [
    ...rows.map((r, i) => ({ ...r, rank: i + 1, color: seriesColor(0) })),
    ...(otherValue > 0
      ? [{ key: "__other", label: t("charts.other"), value: otherValue, rank: null, color: OTHER_COLOR } as const]
      : []),
  ];

  return (
    <ol data-chart-kit="" aria-label={label} className="orrn-chart-in m-0 flex list-none flex-col gap-3.5 p-0">
      {all.map((row) => {
        const pct = (row.value / peak) * 100;
        const share = "share" in row ? row.share : undefined;
        const movement = "movement" in row ? row.movement : undefined;
        return (
          <li
            key={row.key}
            data-slot="ranked-row"
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-1.5"
          >
            <span className="text-right font-mono text-[13px] text-muted-foreground tabular-nums">
              {row.rank ?? ""}
            </span>
            <span data-slot="ranked-label" className="min-w-0 text-[14px] leading-5 font-medium break-words">
              {row.label}
            </span>
            <span data-slot="ranked-value" data-no-truncate="" className="font-mono text-[14px] font-semibold whitespace-nowrap">
              {format(row.value)}
            </span>
            <div className="col-start-2 col-end-4 flex min-w-0 items-center gap-2">
              <div className="h-2.5 min-w-0 flex-1">
                <div
                  aria-hidden="true"
                  className="h-full rounded-r-[4px]"
                  style={{ width: `max(2px, ${pct.toFixed(2)}%)`, background: row.color }}
                />
              </div>
              {share !== undefined ? (
                <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                  {formatShare(share)}
                </span>
              ) : null}
              {movement !== undefined ? <Movement value={movement} /> : null}
            </div>
            {movement !== undefined ? <span className="sr-only">{movementText(t, movement, true)}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Movement({ value }: { value: number | null }) {
  const { t } = useT();
  const Icon = value === null ? Sparkle : value > 0 ? ArrowUp : value < 0 ? ArrowDown : Equal;
  return (
    <span
      data-slot="rank-movement"
      aria-hidden="true"
      className={cn(
        "inline-flex min-h-6 shrink-0 items-center gap-1 rounded-full bg-surface-sunken px-2 text-[12px] leading-none font-semibold whitespace-nowrap text-foreground",
      )}
    >
      <Icon className="size-3.5" strokeWidth={2} />
      {movementText(t, value)}
    </span>
  );
}
