import { formatKg, type LengthUnit } from "@orrn/domain";
import { useToastLift } from "@orrn/ui/hooks/use-toast-lift";
import { cn } from "@orrn/ui/lib/utils";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

/** Small shared pieces of the Pack screens. */

export type DieRange = { weightMinG: number; weightMaxG: number };

/** kg/12ft as the floor reads it: two decimals, en-IN. */
export function formatK12(k: number): string {
  return formatKg(k, 2);
}

/** Range limits for copy ("2.4"): one decimal unless the die stores finer. */
export function formatRangeKg(g: number): string {
  const kg = g / 1000;
  return Number.isInteger(kg * 10) ? kg.toFixed(1) : formatKg(kg, 2);
}

/**
 * Whether the die's range is known: `loading` while `die.get` runs, `failed`
 * when it did not load. Until it is `ready` a bundle cannot be judged, so the
 * chips never claim "No range set" for a die that has one.
 */
export type RangeState = "ready" | "loading" | "failed";

/**
 * The sticky action bar of the pack flow: above the phone tab bar, pinned to
 * the bottom while the page scrolls, with a summary on the left and the
 * step's buttons on the right. With a summary it stays one row on phones
 * (the summary text wraps, the button keeps its width) so the bar stays
 * short; without one the last button grows to the full width left over
 * (and the buttons wrap only when they cannot share one row).
 */
export function PackBar({
  summary,
  notice,
  children,
  className,
}: {
  summary?: ReactNode;
  /**
   * A message that must be seen where the action is (a failed save): its own
   * row at the top of the bar, so it is never under the bar or below the list.
   */
  notice?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusClearance(ref);
  // "Session saved" and other toasts rise above the bar instead of covering Review / Save.
  useToastLift(ref);
  return (
    <div
      ref={ref}
      data-slot="pack-bar"
      className={cn(
        "sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-20 mt-2 flex items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card/95 p-2 pl-4 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-card/85",
        summary && !notice ? "flex-nowrap" : "flex-wrap",
        className,
      )}
    >
      {notice ? <div className="-ml-2 w-full min-w-0">{notice}</div> : null}
      {summary ? <div className="min-w-0 flex-1">{summary}</div> : <div className="flex-1 max-sm:hidden" />}
      <div
        className={cn(
          "flex min-w-0 flex-wrap justify-end gap-2",
          // Without a summary (Review): on phones the last button (the main action) takes the spare width.
          summary ? "shrink-0" : "max-sm:w-full max-sm:[&>*:last-child]:flex-1",
        )}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * While a sticky bottom bar is on screen, the page keeps focused controls
 * above it: `scroll-padding-bottom` on the page scroller = the bar's height
 * plus its distance from the bottom (the phone tab bar). Without it, Tab onto
 * a row that sits under the bar leaves that row hidden (WCAG 2.4.11). A
 * hidden bar (step 1 while the die list is open) clears it.
 */
function useFocusClearance(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const apply = () => {
      const height = el.offsetHeight;
      const bottom = Number.parseFloat(getComputedStyle(el).bottom) || 0;
      root.style.scrollPaddingBottom = height > 0 ? `${Math.ceil(height + bottom + 8)}px` : "";
    };
    apply();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    resize?.observe(el);
    // The tab bar offset changes at the iPad breakpoint.
    window.addEventListener("resize", apply);
    return () => {
      resize?.disconnect();
      window.removeEventListener("resize", apply);
      root.style.scrollPaddingBottom = "";
    };
  }, [ref]);
}

/** Mono value with a quiet unit after it ("52.40 kg"). Never wraps between number and unit. */
export function Measure({ value, unit, className }: { value: string; unit: string; className?: string }) {
  return (
    <span data-no-truncate="" className={cn("whitespace-nowrap", className)}>
      <span className="font-mono tabular-nums">{value}</span>
      <span className="ml-1 text-[0.85em] text-muted-foreground">{unit}</span>
    </span>
  );
}

export function lengthUnitOf(settings: unknown): LengthUnit {
  const unit = (settings as { lengthUnit?: unknown } | null | undefined)?.lengthUnit;
  return unit === "inch" ? "inch" : "mm";
}

export function timezoneOf(settings: unknown): string {
  const tz = (settings as { timezone?: unknown } | null | undefined)?.timezone;
  return typeof tz === "string" && tz ? tz : "Asia/Kolkata";
}
