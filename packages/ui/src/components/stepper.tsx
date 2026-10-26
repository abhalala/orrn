import { useT } from "@orrn/i18n";
import { Check } from "lucide-react";

import { cn } from "@orrn/ui/lib/utils";

export type StepperProps = {
  /** Step names, in order ("Build", "Hold", "Dispatch"). */
  steps: string[];
  /** Index of the current step, 0-based. */
  current: number;
  className?: string;
};

/**
 * Progress through a short flow (2-5 steps). Phones get "Step 2 of 3" with a
 * row of bars; wider screens get numbered pills. It is not navigation: steps
 * are text, the flow's own buttons move between them. Screen readers hear
 * each step with its state; the current one has `aria-current="step"`.
 */
export function Stepper({ steps, current, className }: StepperProps) {
  const { t } = useT();
  const total = steps.length;
  const index = Math.min(Math.max(current, 0), Math.max(total - 1, 0));
  const currentLabel = steps[index] ?? "";

  return (
    <div data-slot="stepper" className={cn("flex min-w-0 flex-col gap-2", className)}>
      <p aria-hidden="true" className="m-0 text-[13px] font-medium text-muted-foreground sm:hidden">
        {t("ui.stepOf", { n: index + 1, total })}: <span className="font-semibold text-foreground">{currentLabel}</span>
      </p>
      <ol className="m-0 flex list-none gap-1.5 p-0 sm:flex-wrap sm:gap-2">
        {steps.map((label, i) => {
          const state = i < index ? "done" : i === index ? "current" : "upcoming";
          return (
            <li
              key={`${i}-${label}`}
              aria-current={state === "current" ? "step" : undefined}
              className="min-w-0 flex-1 sm:flex-none"
            >
              <span className="sr-only">
                {t("ui.stepOf", { n: i + 1, total })}: {label}
                {state === "done" ? `, ${t("ui.stepDone")}` : state === "current" ? `, ${t("ui.stepCurrent")}` : ""}
              </span>
              {/* Phone: a bar per step. */}
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1.5 rounded-full transition-colors duration-[var(--dur-base)] sm:hidden",
                  state === "upcoming" ? "bg-control/35" : "bg-foreground",
                )}
              />
              {/* Tablet and up: numbered pills. */}
              <span
                aria-hidden="true"
                className={cn(
                  "hidden h-8 items-center gap-2 rounded-full pr-3.5 pl-1 text-[13px] font-semibold whitespace-nowrap sm:inline-flex",
                  state === "current" && "bg-primary text-primary-foreground",
                  state === "done" && "border border-border bg-card text-foreground",
                  state === "upcoming" && "bg-surface-sunken text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-[12px] tabular-nums",
                    state === "current" && "bg-primary-foreground/18",
                    state === "done" && "bg-tone-green-tint text-tone-green-ink",
                    state === "upcoming" && "bg-card text-muted-foreground dark:bg-surface-overlay",
                  )}
                >
                  {state === "done" ? <Check className="size-3.5" strokeWidth={2} /> : i + 1}
                </span>
                {label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
