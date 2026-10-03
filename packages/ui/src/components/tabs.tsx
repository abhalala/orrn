import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type TabItem = {
  id: string;
  label: ReactNode;
};

export type TabsProps = {
  items: TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the tab list. */
  label?: string;
  className?: string;
  /** The selected tab's panel. Without children the tabs act as a section switch only. */
  children?: ReactNode;
};

/**
 * Sections of one screen (Settings: Company, Team, Data). Real ARIA tabs:
 * one tab stop, arrow keys move and select, Home/End jump. Underlined, so
 * they never read as the `SegmentedControl` (which filters a list).
 */
export function Tabs({ items, value, onValueChange, label, className, children }: TabsProps) {
  const uid = useId().replace(/:/g, "");
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIndex = Math.max(
    0,
    items.findIndex((it) => it.id === value),
  );
  const hasPanel = children !== undefined && children !== null;

  const move = (to: number) => {
    const i = (to + items.length) % items.length;
    const next = items[i];
    if (!next) return;
    onValueChange(next.id);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const keys: Record<string, number> = {
      ArrowRight: i + 1,
      ArrowLeft: i - 1,
      Home: 0,
      End: items.length - 1,
    };
    const to = keys[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(to);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)}>
      <div
        role="tablist"
        aria-label={label}
        className="flex max-w-full gap-1 overflow-x-auto border-b border-border [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((it, i) => {
          const active = i === selectedIndex;
          return (
            <button
              key={it.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`tab-${uid}-${it.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={hasPanel && active ? `tabpanel-${uid}` : undefined}
              tabIndex={active ? 0 : -1}
              onClick={() => onValueChange(it.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={cn(
                "relative -mb-px inline-flex h-11 shrink-0 items-center gap-1.5 rounded-t-input px-3.5 text-[15px] font-semibold whitespace-nowrap transition-colors duration-[var(--dur-fast)] focus-visible:-outline-offset-2",
                "after:absolute after:inset-x-2 after:bottom-0 after:h-[3px] after:origin-center after:rounded-full after:bg-foreground after:transition-transform after:duration-[var(--dur-base)] after:ease-[var(--ease-spring)]",
                active
                  ? "text-foreground after:scale-x-100"
                  : "text-muted-foreground after:scale-x-0 hover:text-foreground",
              )}
            >
              {it.label}
            </button>
          );
        })}
      </div>
      {hasPanel ? (
        <div
          role="tabpanel"
          id={`tabpanel-${uid}`}
          aria-labelledby={`tab-${uid}-${items[selectedIndex]?.id ?? ""}`}
          tabIndex={0}
          className="min-w-0 focus-visible:outline-offset-4"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
