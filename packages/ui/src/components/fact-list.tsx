import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type FactListProps = HTMLAttributes<HTMLDListElement> & {
  children: ReactNode;
};

/**
 * Label-over-value facts for detail pages: two columns (short facts pair up
 * even on phones), each cell `min-w-0` so long values ellipsise or wrap inside
 * their own cell instead of pushing neighbours. Use `wide` on a `Fact` for
 * names, notes and addresses.
 */
export function FactList({ className, children, ...rest }: FactListProps) {
  return (
    <dl className={cn("m-0 grid grid-cols-2 gap-x-4 gap-y-4 sm:gap-x-6", className)} {...rest}>
      {children}
    </dl>
  );
}

export type FactProps = {
  label: ReactNode;
  children: ReactNode;
  /** Span both columns (names, notes, addresses). */
  wide?: boolean;
  /** Geist Mono for codes, serials and numbers. */
  mono?: boolean;
  /** Keep the value on one line with an ellipsis; the full value goes in `title`. */
  truncate?: boolean;
  title?: string;
  className?: string;
};

export function Fact({ label, children, wide, mono, truncate, title, className }: FactProps) {
  const autoTitle =
    title ?? (truncate && (typeof children === "string" || typeof children === "number") ? String(children) : undefined);
  return (
    <div className={cn("min-w-0", wide && "col-span-2", className)}>
      <dt className="text-[13px] font-medium text-muted-foreground">{label}</dt>
      <dd
        title={autoTitle}
        className={cn(
          "m-0 mt-1 min-w-0 text-[15px] text-foreground",
          truncate ? "truncate" : "break-words",
          mono && "font-mono tabular-nums",
        )}
      >
        {children}
      </dd>
    </div>
  );
}
