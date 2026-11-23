import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { useQuery } from "@tanstack/react-query";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkOn } from "./hooks";
import { bundleStepBadge, processWord, stepPath } from "./model";

/**
 * The bundle page's job-work line (row 33): "At vendor JW/.. since 3 Oct" or "On process step PS/.. since 3 Oct" while the
 * bundle is held on a step, and the finish it carries once it has one. Read from `process.forBundle` (any member). Says
 * nothing for a bundle that never met a step, so a plant without the module sees no new line.
 */
export function BundleStepBadge({ bundleId }: { bundleId: string }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const on = useJobworkOn();
  const q = useQuery({ ...trpc.process.forBundle.queryOptions({ bundleId }), enabled: on, staleTime: 30_000, meta: INLINE_ERROR_META, retry: false });
  const d = q.data;
  if (!d) return null;
  const badge = bundleStepBadge(d.open);
  if (!badge && !d.finish) return null;
  return (
    <section aria-labelledby="bundle-steps" data-testid="bundle-steps" data-state={badge?.kind ?? "free"} className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="bundle-steps" className="m-0 text-[17px] font-semibold">
          {t("jw.bundle.title")}
        </h2>
        {badge ? (
          <Chip tone={badge.kind === "vendor" ? "blue" : "amber"} truncate={false} data-testid="step-badge">
            {badge.kind === "vendor" ? t("jw.bundle.atVendor") : t("jw.bundle.onStep")}
          </Chip>
        ) : null}
      </div>
      {badge ? (
        <p className="m-0 text-[15px]">
          <UiLink to={stepPath(badge.stepId)} className="font-mono font-semibold" data-testid="step-badge-link">
            {badge.number}
          </UiLink>{" "}
          <span className="text-muted-foreground">
            {badge.kind === "vendor" && badge.vendorName ? t("jw.bundle.sinceAt", { vendor: badge.vendorName, date: when(badge.at) }) : t("jw.bundle.since", { date: when(badge.at) })}
          </span>
        </p>
      ) : null}
      {d.finish ? (
        <p className="m-0 text-[14px] text-muted-foreground" data-testid="bundle-finish">
          {t("jw.bundle.finish", { finish: t(`jw.process.${processWord(d.finish)}`), code: d.finishCode ?? "" }).trim()}
        </p>
      ) : null}
      {d.history.length > 0 ? (
        <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px] text-muted-foreground" data-testid="bundle-step-history">
          {d.history.map((h) => (
            <li key={h.stepId}>
              <UiLink to={stepPath(h.stepId)} className="font-mono">
                {h.number}
              </UiLink>{" "}
              {t(`jw.status.${h.status}`)}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
