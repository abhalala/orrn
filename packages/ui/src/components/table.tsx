import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

type StackBag = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };

export function Table({ children, className, ...rest }: StackBag) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function TableHeader({ children, className, ...rest }: StackBag) {
  return (
    <div
      className={cn(
        "flex flex-row items-center gap-2 border-b border-border bg-muted px-3 py-2.5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function TableBody({ children, className, ...rest }: StackBag) {
  return (
    <div className={cn("flex flex-col", className)} {...rest}>
      {children}
    </div>
  );
}

export function TableRow({ children, className, ...rest }: StackBag) {
  return (
    <div
      className={cn(
        "flex flex-row items-stretch gap-2 border-b border-border px-3 py-3 hover:bg-accent/30 last:border-b-0",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function TableHead({
  children,
  flex = 1,
  align = "left",
  className,
  style,
  ...rest
}: StackBag & { flex?: number; align?: "left" | "right" | "center" }) {
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <div
      className={cn("flex items-center", justify, className)}
      style={{ flex, ...style }}
      {...rest}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {children}
      </span>
    </div>
  );
}

export function TableCell({
  children,
  flex = 1,
  align = "left",
  className,
  style,
  ...rest
}: StackBag & { flex?: number; align?: "left" | "right" | "center" }) {
  const justify =
    align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";
  return (
    <div
      className={cn("flex items-center", justify, className)}
      style={{ flex, ...style }}
      {...rest}
    >
      {typeof children === "string" || typeof children === "number" ? (
        <span className="text-sm text-foreground">{children}</span>
      ) : (
        children
      )}
    </div>
  );
}
