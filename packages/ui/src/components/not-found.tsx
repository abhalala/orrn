import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

const RECOVERY_POINTS = [
  "Route checked",
  "Tenant scope preserved",
  "No data exposed",
] as const;

export type NotFoundPageProps = {
  eyebrow?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
};

export function NotFoundPage({
  eyebrow = "Error 404: page not found",
  title = "This work order is off the route.",
  description = "The page may have moved, the link may be stale, or your current company does not have access to it.",
  primaryAction,
  secondaryAction,
  className,
}: NotFoundPageProps) {
  return (
    <main
      className={cn(
        "flex min-h-[100dvh] w-full items-center bg-background px-4 py-12 text-foreground sm:px-6 lg:px-8",
        className,
      )}
    >
      <section className="mx-auto grid w-full max-w-[1100px] items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] lg:gap-16">
        <div className="orrn-rise space-y-6 text-center lg:text-left">
          <p className="m-0 text-sm font-medium text-muted-foreground">{eyebrow}</p>
          <div className="space-y-4">
            <h1 className="m-0 text-balance font-display text-[clamp(2.25rem,1.4rem+3.6vw,4rem)] font-extrabold leading-[1] tracking-[-0.04em] text-foreground">
              {title}
            </h1>
            <p className="mx-auto m-0 max-w-xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg lg:mx-0">
              {description}
            </p>
          </div>

          {(primaryAction || secondaryAction) ? (
            <div className="flex flex-col justify-center gap-3 sm:flex-row lg:justify-start">
              {primaryAction}
              {secondaryAction}
            </div>
          ) : null}
        </div>

        <div className="orrn-rise mx-auto w-full max-w-md space-y-3 [--rise-delay:80ms] lg:max-w-none">
          <div className="orrn-block orrn-block-neutral orrn-block-hero p-6">
            <p className="m-0 text-sm font-semibold">Route not found</p>
            <p aria-hidden="true" className="m-0 mt-6 font-display text-[clamp(4.5rem,14vw,7.5rem)] font-extrabold leading-[0.9] tracking-[-0.05em]">
              404
            </p>
          </div>
          <ul className="m-0 list-none rounded-card border border-border bg-card p-0 px-4">
            {RECOVERY_POINTS.map((point) => (
              <li
                key={point}
                className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-b-0"
              >
                <span className="text-foreground">{point}</span>
                <span className="inline-flex min-h-[22px] items-center rounded-full bg-tone-green-tint px-2.5 text-[11px] font-semibold text-tone-green-ink">
                  OK
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
