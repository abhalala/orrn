import { bundleTone, type BundleStatus } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { PALETTE_CLASSES } from "@orrn/ui/components/badge";
import { cn } from "@orrn/ui/lib/utils";
import { Check } from "lucide-react";

export type StatusFilterValue = BundleStatus | "all";

/** The status colour as a small dot on an unselected chip (static class names for Tailwind). */
const DOT: Record<string, string> = {
  green: "bg-tone-green",
  blue: "bg-tone-blue",
  amber: "bg-tone-amber",
  red: "bg-tone-red",
  neutral: "bg-tone-neutral-ink",
};

/**
 * Status chips above a bundle list: toggle buttons (`aria-pressed`), one on
 * at a time. They wrap instead of squeezing, so long Hindi words never clip
 * at 375px. The selected chip wears its status tint and a check mark.
 */
export function StatusFilter({
  value,
  options,
  onChange,
}: {
  value: StatusFilterValue;
  options: readonly StatusFilterValue[];
  onChange(next: StatusFilterValue): void;
}) {
  const { t } = useT();
  return (
    <div role="group" aria-label={t("stock.filterStatus")} className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = opt === value;
        const tone = opt === "all" ? null : bundleTone(opt);
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={active}
            data-status={opt}
            onClick={() => onChange(opt)}
            className={cn(
              "animate-press inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[14px] font-semibold whitespace-nowrap transition-[background-color,border-color,color,scale] duration-[var(--dur-fast)]",
              active
                ? tone
                  ? cn("border-transparent", PALETTE_CLASSES[tone])
                  : "border-transparent bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-surface-sunken",
            )}
          >
            {/* The check is the non-colour cue for the selected chip. */}
            {active ? (
              <Check aria-hidden="true" strokeWidth={2} className="size-4 shrink-0" />
            ) : tone ? (
              <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[tone])} />
            ) : null}
            {opt === "all" ? t("common.all") : t(`status.bundle.${opt}`)}
          </button>
        );
      })}
    </div>
  );
}
