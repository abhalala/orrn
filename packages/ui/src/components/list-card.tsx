import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

/**
 * Put on the card's primary link: its hit area stretches over the whole card,
 * so a phone user can tap anywhere on it. Other links or buttons inside the
 * card sit above it (ListCard lifts `action` and `footer`).
 */
export const stretchedLink =
  "no-underline after:absolute after:inset-0 after:rounded-card after:content-[''] focus-visible:outline-none focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-[var(--ring)]";

export type ListCardFact = {
  label: ReactNode;
  value: ReactNode;
  /** Full value for the tooltip when it may be cut. */
  title?: string;
  mono?: boolean;
};

export type ListCardProps = {
  /** Key value, usually a router link with `stretchedLink`. Mono codes read best. */
  title: ReactNode;
  /** Full title text for the tooltip when it is a node. */
  titleText?: string;
  mono?: boolean;
  subtitle?: ReactNode;
  subtitleText?: string;
  /** Status chip, always with its status word. */
  status?: ReactNode;
  /** A secondary control (button or link) in the header row. */
  action?: ReactNode;
  /** Two or three secondary facts. */
  facts?: ListCardFact[];
  footer?: ReactNode;
  className?: string;
};

/**
 * Stacked list card used on every list screen: key value first (mono for
 * serials and codes) with the status chip on the same line, a short subtitle,
 * then a row of 2-3 facts. Everything ellipsises inside its own cell.
 */
export function ListCard({
  title,
  titleText,
  mono,
  subtitle,
  subtitleText,
  status,
  action,
  facts,
  footer,
  className,
}: ListCardProps) {
  return (
    <div
      className={cn(
        "relative flex h-full min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 shadow-sm transition-[border-color,transform] duration-[var(--dur-fast)] has-[a:hover]:border-control/60 active:scale-[0.99]",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            title={titleText}
            className={cn(
              "truncate text-[15px] font-semibold leading-6 text-foreground",
              mono && "font-mono tabular-nums",
            )}
          >
            {title}
          </div>
          {subtitle ? (
            <div title={subtitleText} className="truncate text-[13px] leading-5 text-muted-foreground">
              {subtitle}
            </div>
          ) : null}
        </div>
        {status ? <div className="shrink-0 pt-0.5">{status}</div> : null}
        {action ? <div className="relative z-10 shrink-0">{action}</div> : null}
      </div>
      {facts && facts.length > 0 ? (
        <dl className="m-0 grid grid-cols-3 gap-3">
          {facts.map((fact, i) => (
            <div key={i} className="min-w-0">
              <dt className="truncate text-xs font-medium text-muted-foreground">{fact.label}</dt>
              <dd
                title={fact.title ?? (typeof fact.value === "string" ? fact.value : undefined)}
                className={cn(
                  "m-0 mt-0.5 truncate text-sm tabular-nums text-foreground",
                  fact.mono && "font-mono",
                )}
              >
                {fact.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {footer ? (
        <div className="relative z-10 mt-auto flex min-w-0 items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
