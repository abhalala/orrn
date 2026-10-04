import { formatKg, type LengthUnit } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { cn } from "@orrn/ui/lib/utils";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { bundleKgPer12ft, rangeVerdict, type RangeVerdict } from "./pack-math";

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

/** kg/12ft and its verdict for one bundle against its die. */
export function bundleRange(
  b: { weightG: number; pieces: number; lengthMm: number },
  die: DieRange | null | undefined,
): { k: number | null; verdict: RangeVerdict | null } {
  const k = bundleKgPer12ft(b);
  return { k, verdict: k !== null && die ? rangeVerdict(k, die) : null };
}

const VERDICT_KEY = {
  in: "status.range.inRange",
  below: "status.range.below",
  above: "status.range.above",
} as const;

/** "In range" (green) or "Below range" / "Above range" (amber); "No range set" when the die has none. */
export function RangeChip({ verdict, className }: { verdict: RangeVerdict | null; className?: string }) {
  const { t } = useT();
  if (!verdict) {
    return (
      <Chip tone="neutral" className={className}>
        {t("status.range.noRange")}
      </Chip>
    );
  }
  return (
    <Chip tone={verdict === "in" ? "green" : "amber"} className={className} data-verdict={verdict}>
      {t(VERDICT_KEY[verdict])}
    </Chip>
  );
}

export function useVerdictWord() {
  const { t } = useT();
  return (verdict: RangeVerdict | null) => (verdict ? t(VERDICT_KEY[verdict]) : t("status.range.noRange"));
}

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
  children,
  className,
}: {
  summary?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusClearance(ref);
  return (
    <div
      ref={ref}
      data-slot="pack-bar"
      className={cn(
        "sticky bottom-[calc(var(--shell-tabbar-offset)+12px)] z-20 mt-2 flex items-center gap-x-4 gap-y-2 rounded-card border border-border bg-card/95 p-2 pl-4 shadow-md backdrop-blur-md supports-[backdrop-filter]:bg-card/85",
        summary ? "flex-nowrap" : "flex-wrap",
        className,
      )}
    >
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
