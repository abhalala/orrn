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
};

const TONE_CLASSES: Record<NonNullable<StatCardProps["tone"]>, string> = {
  primary: "bg-primary/10 text-primary",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  success: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  danger: "bg-red-500/10 text-red-600 dark:text-red-400",
  neutral: "bg-muted text-muted-foreground",
};

/**
 * Compact KPI card for platform dashboards. Renders a label, value, optional
 * tinted icon, and an optional hint line. Wrap the whole card in a router
 * `Link` when `to` is provided so the entire surface is clickable.
 */
export function StatCard({
  label,
  value,
  hint,
  to,
  icon,
  isLoading,
  tone = "primary",
}: StatCardProps) {
  const body = (
    <Card className="hover:border-primary/40 transition-colors duration-150">
      <div className="flex items-start gap-3">
        {icon ? (
          <div
            className={`flex size-9 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}
          >
            {icon}
          </div>
        ) : null}
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            {label}
          </p>
          {isLoading ? (
            <Skeleton className="h-7 w-16" />
          ) : (
            <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
          )}
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
