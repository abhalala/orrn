import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText, kgWithUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ageTone, bucketCells, groupPendingByVendor, limitState, processWord, stepPath, type PendingItem } from "./model";
import { Panel } from "./ui";

const POLL_MS = 60_000;

/**
 * "At vendors" (row 33): what is out on a job-work challan now, grouped by vendor with the days out, the age bucket and
 * overdue marked. Read from `process.steps.pending`; the server works out the age and the overdue flag on the plant's clock.
 */
export function PendingView() {
  const { t } = useT();
  const fmt = useFmt();
  const q = useQuery({ ...trpc.process.steps.pending.queryOptions(), refetchInterval: POLL_MS, meta: INLINE_ERROR_META });
  if (showsQueryError(q)) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("jw.loadFailed")}
          action={
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  if (!q.data) return <Skeleton className="h-40 rounded-card" aria-busy="true" />;

  const groups = groupPendingByVendor(q.data.items as PendingItem[]);
  const cells = bucketCells(q.data.buckets);
  if (groups.length === 0) {
    return (
      <div className="rounded-card border border-border bg-card" data-testid="pending-empty">
        <EmptyState
          title={t("jw.pending.empty")}
          body={t("jw.pending.emptyBody")}
          action={
            <Can do="jobwork.send">
              <Button asChild>
                <UiLink to="/jobwork/new" className="no-underline">
                  {t("jw.action.newChallan")}
                </UiLink>
              </Button>
            </Can>
          }
        />
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label={t("jw.pending.buckets")} data-testid="age-buckets">
        {cells.map((c) => (
          <li key={c.bucket} data-bucket={c.bucket}>
            <Chip tone={c.steps > 0 ? c.tone : "neutral"} truncate={false}>
              {t(`jw.ageBucket.${c.bucket}`)} · {t("jw.pending.bucketCount", { count: c.steps })}
              {c.steps > 0 ? ` · ${kgWithUnit(fmt, c.outG)}` : ""}
            </Chip>
          </li>
        ))}
      </ul>
      <div className="flex min-w-0 flex-col gap-4" data-testid="pending-groups">
        {groups.map((g) => (
          <Panel key={g.key} className="flex min-w-0 flex-col gap-3" data-testid="pending-vendor" data-vendor={g.vendorCode}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="m-0 text-[17px] font-semibold break-words">
                {g.vendorName} <span className="font-mono text-[14px] font-medium text-muted-foreground">{g.vendorCode}</span>
              </h3>
              <p className="m-0 text-[14px] text-muted-foreground">
                {t("jw.pending.vendorTotal", { bundles: g.outBundles, weight: kgWithUnit(fmt, g.outG) })}
                {g.overdue > 0 ? ` · ${t("jw.pending.overdueCount", { count: g.overdue })}` : ""}
              </p>
            </div>
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {g.steps.map((s) => (
                <li key={s.id} className="flex min-w-0 flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-testid="pending-step" data-step={s.number} data-overdue={s.overdue ? "true" : "false"}>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <UiLink to={stepPath(s.id)} className="font-mono text-[15px] font-semibold">
                      {s.number}
                    </UiLink>
                    <span className="text-[14px] break-words text-muted-foreground">
                      {[t(`jw.process.${processWord(s.process)}`), s.finishCode, t("jw.pending.stepTotal", { bundles: s.outBundles, pcs: s.outPcs, weight: kgWithUnit(fmt, s.outG) })].filter(Boolean).join(" · ")}
                    </span>
                    {s.expectedReturn ? (
                      <span className="text-[13px] text-muted-foreground">{t("jw.pending.expected", { date: bookDateText(fmt, s.expectedReturn) })}</span>
                    ) : null}
                    {limitState(s.daysToLimit) !== "ok" ? (
                      <span className="text-[13px] font-medium text-tone-amber-ink" data-testid="limit-note">
                        {limitState(s.daysToLimit) === "over" ? t("jw.pending.limitOver") : t("jw.pending.limitSoon", { count: s.daysToLimit })}
                      </span>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {s.overdue ? (
                      <Chip tone="red" truncate={false} data-testid="overdue-chip">
                        {t("jw.pending.overdue")}
                      </Chip>
                    ) : null}
                    <Chip tone={ageTone(s.bucket, s.overdue)} truncate={false} data-testid="days-chip">
                      {t("jw.pending.daysOut", { count: s.days })}
                    </Chip>
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
