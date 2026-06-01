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
  eyebrow = "404 / Not found",
  title = "This work order is off the route.",
  description = "The page may have moved, the link may be stale, or your current company does not have access to it.",
  primaryAction,
  secondaryAction,
  className,
}: NotFoundPageProps) {
  return (
    <main
      className={cn(
        "relative isolate flex min-h-screen w-full items-center overflow-hidden bg-background px-4 py-10 text-foreground sm:px-6 lg:px-8",
        className,
      )}
    >
      <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_top_left,color-mix(in_srgb,var(--primary)_22%,transparent),transparent_34%),radial-gradient(circle_at_bottom_right,color-mix(in_srgb,var(--primary)_14%,transparent),transparent_30%)]" />
      <div className="absolute inset-0 -z-10 bg-[linear-gradient(color-mix(in_srgb,var(--border)_58%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--border)_58%,transparent)_1px,transparent_1px)] bg-[size:42px_42px] opacity-35 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />

      <section className="mx-auto grid w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(320px,0.75fr)]">
        <div className="space-y-7 text-center lg:text-left">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/80 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground shadow-sm backdrop-blur">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_18px_color-mix(in_srgb,var(--primary)_80%,transparent)]" />
            {eyebrow}
          </div>

          <div className="space-y-4">
            <p aria-hidden="true" className="m-0 font-mono text-[clamp(4.5rem,22vw,12rem)] font-semibold leading-none tracking-[-0.12em] text-foreground/10">
              404
            </p>
            <h1 className="m-0 text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              {title}
            </h1>
            <p className="mx-auto m-0 max-w-2xl text-pretty text-base leading-7 text-muted-foreground sm:text-lg lg:mx-0">
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

        <div className="relative mx-auto w-full max-w-md lg:max-w-none">
          <div className="absolute -inset-4 rounded-[2rem] bg-primary/10 blur-3xl" />
          <div className="relative overflow-hidden rounded-2xl border border-border bg-card/92 p-4 shadow-2xl shadow-foreground/10 backdrop-blur sm:p-5">
            <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-destructive" />
                <span className="size-2.5 rounded-full bg-amber-400" />
                <span className="size-2.5 rounded-full bg-emerald-500" />
              </div>
              <span className="font-mono text-xs text-muted-foreground">orrn://ops/not-found</span>
            </div>

            <div className="rounded-xl border border-border bg-background p-4">
              <div className="grid grid-cols-[1fr_auto] gap-4">
                <div className="space-y-3">
                  <div className="h-2 w-24 rounded-full bg-primary/60" />
                  <div className="h-2 w-40 rounded-full bg-muted" />
                  <div className="h-2 w-32 rounded-full bg-muted" />
                </div>
                <div className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card font-mono text-lg font-semibold text-primary">
                  404
                </div>
              </div>

              <div className="mt-5 grid gap-2">
                {RECOVERY_POINTS.map((point) => (
                  <div key={point} className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2 text-sm">
                    <span className="text-muted-foreground">{point}</span>
                    <span className="font-mono text-xs font-semibold text-primary">OK</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2" aria-hidden="true">
              <div className="h-16 rounded-xl border border-border bg-background/70" />
              <div className="h-16 rounded-xl border border-primary/40 bg-primary/10" />
              <div className="h-16 rounded-xl border border-border bg-background/70" />
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
