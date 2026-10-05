import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useId, type ReactNode } from "react";

/**
 * A quiet list section on Today: a white card with an h2, an optional "All
 * ..." link on the right and the rows (or the section's empty state).
 */
export function TodaySection({
  testId,
  title,
  more,
  children,
}: {
  testId: string;
  title: string;
  more?: { to: string; label: string };
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-testid={testId}
      className="flex min-w-0 flex-col rounded-card border border-border bg-card"
    >
      <div className="flex min-w-0 items-center justify-between gap-3 py-2 pr-2 pl-4 sm:pl-5">
        <h2 id={headingId} className="m-0 min-w-0 text-[17px] leading-6 font-semibold tracking-[-0.01em] break-words">
          {title}
        </h2>
        {more ? (
          <Button asChild variant="ghost" className="shrink-0 px-3.5 text-[14px]">
            <UiLink to={more.to}>{more.label}</UiLink>
          </Button>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Rows of a Today list: real list semantics, one hairline between rows. */
export function TodayRows({ children }: { children: ReactNode }) {
  return <ul className="m-0 list-none divide-y divide-border border-t border-border p-0">{children}</ul>;
}

/**
 * Empty list: one plain sentence, why it will fill up, and the next step
 * for people who can take it (`action`, usually inside a `<Can>`, renders
 * nothing for everyone else).
 */
export function TodayEmptyRows({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-1 border-t border-border px-4 py-6 sm:px-5">
      <p className="m-0 text-[15px] leading-6 font-semibold">{title}</p>
      <p className="m-0 text-[14px] leading-5 text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

/** The one button under an empty list (a link styled as a secondary pill). */
export function TodayEmptyAction({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild variant="secondary" className="mt-3">
      <UiLink to={to}>{label}</UiLink>
    </Button>
  );
}

/** A name under a row's code: up to two lines, so long firm names stay readable on touch (no hover title there). */
export const rowNameClass = "line-clamp-2 text-[13px] leading-5 text-muted-foreground [overflow-wrap:anywhere]";

/** Row hit area: the whole row is the link, at least 64px tall for thumbs. */
export const rowLinkClass =
  "flex min-h-16 min-w-0 items-center gap-3 px-4 py-3 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-surface-sunken/70 focus-visible:-outline-offset-2 active:bg-surface-sunken sm:px-5";

/** Loading shape of a list section. */
export function TodaySectionSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col rounded-card border border-border bg-card">
      <div className="flex h-15 items-center px-4 sm:px-5">
        <Skeleton className="h-5 w-40" />
      </div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex min-h-16 items-center justify-between gap-3 border-t border-border px-4 sm:px-5">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3.5 w-44" />
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
      ))}
    </div>
  );
}
