import { useToastLift } from "@orrn/ui/hooks/use-toast-lift";
import { useRef, type HTMLAttributes, type ReactNode } from "react";

/**
 * A screen's own sticky action bar (one that is not `FormActions`). While it is pinned, toasts and the closed Buddy
 * button lift above it; once it turns static or hidden at a wider breakpoint, nothing lifts (Buddy fix round S9).
 * `data-sticky-bar` lets the layout check in `buddy.spec.ts` find every such bar.
 */
export function StickyBar({ children, ...rest }: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useToastLift(ref, { whenSticky: true });
  return (
    <div ref={ref} data-sticky-bar="" {...rest}>
      {children}
    </div>
  );
}
