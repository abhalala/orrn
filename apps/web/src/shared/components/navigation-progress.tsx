import { useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { cn } from "@orrn/ui/lib/utils";

/**
 * NProgress-style top loader that appears during route loader fetches.
 * Two pieces:
 *   1. A track pinned to the very top of the viewport.
 *   2. An indeterminate bar that slides across while loading and "completes"
 *      with a fade when loading ends.
 */
export function NavigationProgress() {
  const isNavigating = useRouterState({
    select: (s) =>
      s.status === "pending" ||
      // Some TanStack Router versions expose these; treat them as additive.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Boolean((s as any).isLoading) ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Boolean((s as any).isTransitioning),
  });

  // Delay-show so flash-fast navigations (<120ms) don't render the bar at all,
  // which is what makes "modern" sites feel snappy rather than laggy.
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!isNavigating) {
      // On completion, keep the bar visible for one frame so the user sees the
      // sweep-to-full animation finish before fading.
      const id = window.setTimeout(() => setVisible(false), 220);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => setVisible(true), 120);
    return () => window.clearTimeout(id);
  }, [isNavigating]);

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden transition-opacity duration-200",
        visible ? "opacity-100" : "opacity-0",
      )}
    >
      <div
        className={cn(
          "h-full rounded-r-full bg-primary shadow-[0_0_10px_var(--primary)]",
          isNavigating ? "orrn-nav-progress-running" : "orrn-nav-progress-done",
        )}
      />
    </div>
  );
}
