import { Card } from "@orrn/ui/components/card";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export type StatCardProps = {
  label: string;
  value: number | string;
  hint?: string;
  /** Optional internal route the card links to. */
  to?: string;
  icon?: ReactNode;
  isLoading?: boolean;
  /**
   * Tone hint for the leading icon background. Maps to design tokens
   * via Tailwind semantic classes.
   */
  tone?: "primary" | "warning" | "success" | "danger" | "neutral";
  /**
   * Optional series of recent values rendered as a small sparkline under the
   * stat. Only pass real data — omit when no time-series exists.
   */
  trend?: number[];
};

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const w = 72;
  const h = 20;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - 2 - ((v - min) / range) * (h - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      aria-hidden="true"
      className="shrink-0 text-primary"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}

/**
 * Compact KPI card for platform dashboards. Renders a label, value, optional
 * tinted icon, an optional sparkline trend, and an optional hint line. Wrap
 * the whole card in a router `Link` when `to` is provided so the entire
 * surface is clickable.
 */
export function StatCard({
  label,
  value,
  hint,
  to,
  icon,
  isLoading,
  tone = "primary",
  trend,
}: StatCardProps) {
  const interactive = !!to;
  const body = (
    <Card
      className={
        interactive
          ? "group relative overflow-hidden transition-all duration-[var(--dur-fast)] hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
          : "relative overflow-hidden"
      }
    >
      {interactive ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-8 -top-8 size-24 rounded-full bg-primary/10 opacity-0 blur-2xl transition-opacity duration-[var(--dur-base)] group-hover:opacity-100"
        />
      ) : null}
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
          >
            {icon}
          </div>
        ) : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <div className="flex items-end justify-between gap-2">
            {isLoading ? (
              <Skeleton className="h-7 w-16" />
            ) : (
              <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
            )}
            {!isLoading && trend ? <Sparkline data={trend} /> : null}
          </div>
          {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
        </div>
      </div>
    </Card>
  );

  if (!to) return body;

  return (
    <Link to={to as "/"} className="no-underline">
      {body}
    </Link>
  );
}
