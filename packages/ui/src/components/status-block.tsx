import type { StatusTone } from "@orrn/domain";
import { ChevronRight } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

import type { ToneName } from "../tokens";
import { BigNumber } from "./big-number";
import { UiLink } from "./link";

export type StatusBlockProps = {
  /** The status colour; `violet` is the Godseye block (platform console only). */
  tone: StatusTone | Extract<ToneName, "violet">;
  title: string;
  /** One line under the title. Carry the status word here when the title doesn't ("In stock", "Held"). */
  meta?: string;
  value: number | string;
  unit?: string;
  /** 0..1, drawn as a bar under the number. */
  progress?: number;
  href?: string;
  onClick?(): void;
  /** Count a numeric value up from 0 on first render. Default true; off under reduced motion. */
  countUp?: boolean;
  /** Formats a numeric value. Default en-IN grouping. */
  format?: (n: number) => string;
  /** Show a text value in Geist Mono (serials, codes). Default true for text values. */
  mono?: boolean;
  className?: string;
  style?: CSSProperties;
};

/**
 * The C2 status tile: a gradient block whose colour IS the status, with a
 * title, one meta line, a big Bricolage number and an optional progress bar.
 * Text uses the tone's `on` colour at full strength (>= 4.5:1 against the
 * lighter stop, tokens.test.ts); hierarchy comes from size and weight, never
 * from opacity. With `href` it is a link, with `onClick` a button.
 */
export function StatusBlock({
  tone,
  title,
  meta,
  value,
  unit,
  progress,
  href,
  onClick,
  countUp = true,
  format,
  mono,
  className,
  style,
}: StatusBlockProps) {
  const interactive = Boolean(href || onClick);
  const pct = progress === undefined ? undefined : Math.round(Math.min(1, Math.max(0, progress)) * 100);

  const body: ReactNode = (
    <>
      <span className="relative flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[17px] font-bold leading-tight tracking-[-0.02em] break-words">
            {title}
          </span>
          {meta ? <span className="mt-1 block text-[13px] font-medium leading-snug break-words">{meta}</span> : null}
        </span>
        {interactive ? <ChevronRight aria-hidden="true" className="-mr-1 size-5 shrink-0" strokeWidth={2} /> : null}
      </span>
      <span className="relative mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-6">
        {typeof value === "number" ? (
          <BigNumber value={value} format={format} countUp={countUp} className="text-[44px] sm:text-[52px]" />
        ) : (
          <span
            data-no-truncate=""
            className={cn(
              "min-w-0 leading-[0.95] tabular-nums",
              mono ?? true
                ? // A serial or code: one mono block that may break anywhere, never letter-per-line columns.
                  "max-w-full font-mono text-[36px] font-semibold tracking-[-0.02em] [overflow-wrap:anywhere] sm:text-[40px]"
                : "font-display text-[44px] font-extrabold tracking-[-0.04em] break-words sm:text-[52px]",
            )}
          >
            {value}
          </span>
        )}
        {unit ? <span className="min-w-0 text-[13px] font-semibold tabular-nums break-words">{unit}</span> : null}
      </span>
      {pct !== undefined ? (
        <span
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="relative mt-3 block h-1.5 overflow-hidden rounded-full bg-current/25"
        >
          <span
            className="block h-full origin-left rounded-full bg-current"
            style={{ transform: `scaleX(${pct / 100})` }}
          />
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    "orrn-block orrn-block-sheen flex min-h-[168px] w-full min-w-0 flex-col p-[18px] text-left no-underline",
    `orrn-block-${tone}`,
    interactive &&
      "animate-press cursor-pointer transition-[filter,scale] duration-[var(--dur-fast)] hover:brightness-[1.04]",
    className,
  );

  if (href) {
    return (
      <UiLink to={href} data-slot="status-block" data-tone={tone} className={classes} style={style} onClick={onClick}>
        {body}
      </UiLink>
    );
  }
  if (onClick) {
    return (
      <button type="button" data-slot="status-block" data-tone={tone} className={classes} style={style} onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <div data-slot="status-block" data-tone={tone} className={classes} style={style}>
      {body}
    </div>
  );
}
