import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { PrinterX } from "lucide-react";

import { Can } from "@/shared/components/can";

import { formatCount } from "./today-model";

/**
 * Labels that failed to print today (for people who can see the print
 * queue). Only rendered when there is at least one; it says what happened
 * and where to fix it.
 */
export function PrintProblems({ failed }: { failed: number }) {
  const { t } = useT();
  if (failed <= 0) return null;
  return (
    <Can do="spool.view_queue">
      <div
        data-testid="today-print-problems"
        role="status"
        className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5"
      >
        <span
          aria-hidden="true"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-tone-amber-tint text-tone-amber-ink"
        >
          <PrinterX className="size-[22px]" strokeWidth={2} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-[15px] leading-6 font-semibold break-words">
            {t("today.printProblemsCount", { count: formatCount(failed) })}
          </span>
          <span className="text-[14px] leading-5 text-muted-foreground break-words">{t("today.printProblemsBody")}</span>
        </span>
        <Button asChild variant="secondary" className="self-start sm:self-center">
          <UiLink to="/printing">{t("today.openPrinting")}</UiLink>
        </Button>
      </div>
    </Can>
  );
}
