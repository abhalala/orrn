import type { ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type TabItem = {
  id: string;
  label: ReactNode;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  children?: ReactNode;
};

/**
 * C2 segmented control: a sunken pill track with the selected segment raised
 * on the surface. Keeps the simple `items`/`value`/`onValueChange` shape so
 * consumers don't have to change. Segments are toggle buttons
 * (`aria-pressed`), so keyboard users tab through them and press Enter/Space.
 */
export function Tabs({ items, value, onValueChange, className, children }: TabsProps) {
  return (
    <div className={cn("flex min-w-0 max-w-full flex-col gap-4", className)}>
      {/* The track scrolls sideways when the segments outgrow a phone row;
          it never widens the page. */}
      <div className="flex min-w-0 max-w-full gap-1 self-start overflow-x-auto overscroll-x-contain rounded-full bg-surface-sunken p-1 [scrollbar-width:none] dark:bg-background dark:ring-1 dark:ring-border">
        {items.map((it) => {
          const active = value === it.id;
          return (
            <button
              key={it.id}
              type="button"
              aria-pressed={active}
              onClick={() => onValueChange(it.id)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[13px] sm:px-4 font-semibold transition-[background-color,color,box-shadow,transform] duration-[var(--dur-fast)] active:scale-[0.97] pointer-coarse:h-11",
                active
                  ? "bg-card text-foreground shadow-sm dark:bg-popover"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      {children}
    </div>
  );
}
