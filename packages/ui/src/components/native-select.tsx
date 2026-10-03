import { ChevronDown } from "lucide-react";
import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@orrn/ui/lib/utils";

export type NativeSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Compact height for in-row use (44px on phones, 36px with a mouse). */
  density?: "default" | "compact";
};

/**
 * Platform `<select>` styled as a C2 field: 48px on phones (44px from sm),
 * 12px radius, the OS picker on touch devices. Long option text ellipsises.
 */
export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(function NativeSelect(
  { className, density = "default", children, ...rest },
  ref,
) {
  return (
    <span className={cn("relative inline-flex w-full min-w-0", className)}>
      <select
        ref={ref}
        data-slot="native-select"
        className={cn(
          "w-full min-w-0 appearance-none truncate rounded-input border border-input bg-card pl-3.5 pr-10 text-[15px] text-foreground transition-[border-color] duration-[var(--dur-fast)] hover:border-foreground/70 focus-visible:border-foreground disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base",
          density === "compact" ? "h-11 sm:h-9 sm:text-sm pointer-coarse:h-11" : "h-12 sm:h-11",
        )}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
});
