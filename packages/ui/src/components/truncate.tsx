import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type TruncateProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  children: ReactNode;
  /**
   * Full value for the hover tooltip. Defaults to the text when `children` is
   * a string or number. The full text always stays in the DOM, so screen
   * readers read all of it; the ellipsis is visual only.
   */
  title?: string;
  /** 1 = single line with an ellipsis (default); 2 or 3 = clamp to that many lines. */
  lines?: 1 | 2 | 3;
  /** Geist Mono with tabular numbers, for codes, serials, slugs and ids. */
  mono?: boolean;
  as?: "span" | "p" | "div";
};

const CLAMP: Record<2 | 3, string> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
};

/**
 * Text that never spills: a single line with an ellipsis (or a deliberate 2-3
 * line clamp) inside any flex or grid parent. Put it in a row next to a chip
 * or action and give the chip `shrink-0`; the text takes the rest.
 *
 * Long unbroken strings (slugs, codes, emails) stay on one line instead of
 * breaking into per-character columns.
 */
export function Truncate({
  children,
  title,
  lines = 1,
  mono,
  as: Comp = "span",
  className,
  ...rest
}: TruncateProps) {
  const autoTitle =
    title ?? (typeof children === "string" || typeof children === "number" ? String(children) : undefined);
  return (
    <Comp
      data-slot="truncate"
      title={autoTitle}
      className={cn(
        "block min-w-0 max-w-full",
        lines === 1 ? "truncate" : cn(CLAMP[lines], "break-words"),
        mono && "font-mono tabular-nums",
        className,
      )}
      {...rest}
    >
      {children}
    </Comp>
  );
}
