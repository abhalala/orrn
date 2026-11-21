import { useRef, type HTMLAttributes, type ReactNode } from "react";

import { useToastLift } from "@orrn/ui/hooks/use-toast-lift";
import { cn } from "@orrn/ui/lib/utils";

export type FormActionsProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** Phones: keep the bar pinned to the bottom of the screen while the form scrolls. */
  sticky?: boolean;
};

/**
 * Submit row for forms. Put the primary action last.
 *
 * Phones: equal-width pills side by side in a bar that sticks to the bottom of
 * the scroll area, so the submit is always one thumb away.
 * From sm: a right-aligned row of pills in the normal flow.
 *
 * While it is pinned (phones only), toasts and the closed Buddy button lift above it (`useToastLift` with
 * `whenSticky`), so neither covers the primary pill on the right.
 */
export function FormActions({ children, sticky = true, className, ...rest }: FormActionsProps) {
  const ref = useRef<HTMLDivElement>(null);
  useToastLift(ref, { whenSticky: true });
  return (
    <div
      ref={ref}
      data-slot="form-actions"
      data-sticky-bar={sticky ? "" : undefined}
      className={cn(
        // Phones: equal-width pills side by side (secondary left, primary right).
        "flex flex-wrap gap-2 [&>*]:min-w-0 [&>*]:flex-1 [&_[data-slot=button]]:w-full",
        "sm:items-center sm:justify-end sm:[&>*]:flex-none sm:[&_[data-slot=button]]:w-auto",
        sticky &&
          "max-sm:sticky max-sm:bottom-3 max-sm:z-10 max-sm:rounded-card max-sm:border max-sm:border-border max-sm:bg-card/95 max-sm:p-2 max-sm:shadow-md max-sm:backdrop-blur-md",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}
