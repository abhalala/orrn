import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { cn } from "@orrn/ui/lib/utils";
import { Check, ChevronRight } from "lucide-react";
import { useId } from "react";

import { useMe } from "@/shared/lib/me";

import { startHereSteps, type Setup, type StartHereStep } from "./today-model";

/** Step marker: its number while open, a check when done (the word "Done" sits beside it too). */
function Marker({ step, n }: { step: StartHereStep; n: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full font-mono text-[15px] font-semibold tabular-nums",
        step.done ? "bg-tone-green-tint text-tone-green-ink" : "border-2 border-control text-foreground",
      )}
    >
      {step.done ? <Check className="size-[18px]" strokeWidth={2} /> : n}
    </span>
  );
}

/**
 * "Start here" for a plant with no die or no bundle yet (spec §3 Today):
 * four first steps in order, each a link for people whose role can do it,
 * a plain "An admin sets this up" for everyone else, and how many are done.
 * It replaces the KPI blocks, lists and charts, which would all be empty.
 */
export function StartHere({ setup }: { setup: Setup }) {
  const { t } = useT();
  const { data: me } = useMe();
  const headingId = useId();
  const steps = startHereSteps(setup, me);
  const done = steps.filter((s) => s.done).length;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="today-start-here"
      className="animate-rise flex min-w-0 flex-col gap-5 rounded-card border border-border bg-card p-5 sm:p-7"
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <h2
          id={headingId}
          className="m-0 font-display text-[26px] leading-tight font-extrabold tracking-[-0.03em] break-words"
        >
          {t("today.startHere.title")}
        </h2>
        <p className="m-0 max-w-[60ch] text-[15px] leading-6 text-muted-foreground break-words">
          {t("today.startHere.body")}
        </p>
        <p className="m-0 text-[14px] leading-5 font-semibold">
          {t("today.startHere.progress", { done, total: steps.length })}
        </p>
      </div>
      <ol className="m-0 flex list-none flex-col divide-y divide-border border-y border-border p-0">
        {steps.map((step, i) => (
          <li key={step.key} className="min-w-0">
            {!step.done && step.to ? (
              <UiLink
                to={step.to}
                className="-mx-2 flex min-h-16 min-w-0 items-center gap-3 rounded-input px-2 py-3 text-foreground no-underline transition-colors duration-[var(--dur-fast)] hover:bg-surface-sunken/70 active:bg-surface-sunken"
              >
                <Marker step={step} n={i + 1} />
                <span className="min-w-0 flex-1 text-[16px] leading-6 font-semibold break-words">{t(step.labelKey)}</span>
                <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted-foreground" strokeWidth={2} />
              </UiLink>
            ) : (
              <div className="flex min-h-16 min-w-0 items-center gap-3 py-3">
                <Marker step={step} n={i + 1} />
                <span
                  className={cn(
                    "min-w-0 flex-1 text-[16px] leading-6 font-semibold break-words",
                    step.done && "text-muted-foreground",
                  )}
                >
                  {t(step.labelKey)}
                </span>
                {step.done ? (
                  <Chip tone="green">{t("today.startHere.done")}</Chip>
                ) : (
                  <span className="max-w-[45%] text-right text-[13px] leading-5 text-muted-foreground break-words">
                    {t("today.startHere.askAdmin")}
                  </span>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
