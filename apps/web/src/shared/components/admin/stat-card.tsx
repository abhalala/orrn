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
  primary: "bg-tone-violet-tint text-tone-violet-ink",
  warning: "bg-tone-amber-tint text-tone-amber-ink",
  success: "bg-tone-green-tint text-tone-green-ink",
  danger: "bg-tone-red-tint text-tone-red-ink",
  neutral: "bg-surface-sunken text-foreground",
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
      className="shrink-0 text-foreground"
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
          ? "group relative overflow-hidden transition-[border-color,box-shadow,transform] duration-[var(--dur-fast)] hover:border-control/60 hover:shadow-md active:scale-[0.99]"
          : "relative overflow-hidden"
      }
    >
      {/* Stacks (icon over text) in narrow cells such as the 2-up phone
          grid; sits side by side once the card has room. */}
      <div className="@container">
        <div className="flex flex-col items-start gap-2.5 @[15rem]:flex-row @[15rem]:gap-3">
          {icon ? (
            <div
              aria-hidden="true"
              className={`flex size-10 shrink-0 items-center justify-center rounded-md ${TONE_CLASSES[tone]}`}
            >
              {icon}
            </div>
          ) : null}
          <div className="w-full min-w-0 flex-1 space-y-1">
            <p className="m-0 truncate text-[13px] font-medium text-muted-foreground" title={label}>
              {label}
            </p>
            <div className="flex items-end justify-between gap-2">
              {isLoading ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <p className="m-0 font-display text-[34px] font-extrabold leading-none tracking-[-0.035em] tabular-nums text-foreground">{value}</p>
              )}
              {!isLoading && trend ? <Sparkline data={trend} /> : null}
            </div>
            {hint ? (
              <p className="m-0 truncate text-[13px] text-muted-foreground" title={hint}>
                {hint}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  );

  if (!to) return body;

  return (
    <Link to={to as "/"} className="block min-w-0 rounded-card no-underline">
      {body}
    </Link>
  );
}
