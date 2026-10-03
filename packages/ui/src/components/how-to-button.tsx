import { useT, type GuideSlug } from "@orrn/i18n";
import { getGuide } from "@orrn/i18n/guides";
import { BookOpen } from "lucide-react";
import { useState } from "react";

import { cn } from "@orrn/ui/lib/utils";

import { Button } from "./button";
import { Sheet } from "./sheet";

export type GuideSheetProps = {
  slug: GuideSlug;
  open: boolean;
  onOpenChange(open: boolean): void;
};

/** The SOP guide for one job, in the current language, as a sheet. */
export function GuideSheet({ slug, open, onOpenChange }: GuideSheetProps) {
  const { t, locale } = useT();
  const guide = getGuide(slug, locale);
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={guide.title} description={guide.when}>
      <div className="flex flex-col gap-6 pt-1" lang={locale}>
        <section aria-labelledby={`guide-${slug}-steps`} className="flex flex-col gap-3">
          <h3 id={`guide-${slug}-steps`} className="m-0 text-[15px] font-semibold">
            {t("guides.steps")}
          </h3>
          <ol className="m-0 flex list-none flex-col gap-4 p-0">
            {guide.steps.map((step, i) => (
              <li key={step.title} className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 items-center justify-center rounded-full bg-primary text-[13px] font-semibold text-primary-foreground tabular-nums"
                >
                  {i + 1}
                </span>
                <div className="flex min-w-0 flex-col gap-0.5 pt-0.5">
                  <p className="m-0 text-[15px] font-semibold leading-snug">{step.title}</p>
                  <p className="m-0 text-[15px] leading-6 text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        {guide.problems.length ? (
          <section aria-labelledby={`guide-${slug}-problems`} className="flex flex-col gap-3">
            <h3 id={`guide-${slug}-problems`} className="m-0 text-[15px] font-semibold">
              {t("guides.problems")}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {guide.problems.map((p) => (
                <li key={p.title} className="rounded-card bg-surface-sunken px-4 py-3">
                  <p className="m-0 text-[15px] font-semibold leading-snug">{p.title}</p>
                  <p className="m-0 mt-0.5 text-[14px] leading-6 text-muted-foreground">{p.fix}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}

export type HowToButtonProps = {
  slug: GuideSlug;
  className?: string;
};

/** "How to" pill that opens the screen's guide. Quiet (ghost) so it never competes with the main action. */
export function HowToButton({ slug, className }: HowToButtonProps) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant="ghost"
        className={cn("px-4", className)}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <BookOpen aria-hidden="true" strokeWidth={2} />
        {t("common.howTo")}
      </Button>
      <GuideSheet slug={slug} open={open} onOpenChange={setOpen} />
    </>
  );
}
