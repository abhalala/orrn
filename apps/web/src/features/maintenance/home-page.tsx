import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { whenText } from "@/shared/lib/fmt-text";
import { can, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { DUE_TONE, FLAG_TONE, dueLines, isDueState, isPriority, isReadingFlag, isWoStatus, maintErrorKey, maintReady, maintenanceOn, milliText, PRIORITY_TONE, WO_STATUS_TONE } from "./model";

function Section({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="gap-3" data-testid={`maint-${id}`}>
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-semibold">{title}</h2>
        {hint ? <p className="m-0 text-[14px] text-muted-foreground">{hint}</p> : null}
      </div>
      {children}
    </Card>
  );
}

const rowClass = "flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-[15px] first:border-t-0";

/** `/maintenance`: what is due, what is open, press breakdowns waiting for a work order and readings outside limits. */
export function MaintenanceHome() {
  const { t } = useT();
  const fmt = useFmt();
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const ready = maintReady(me.data, ["maint.view"]);
  const opts = { enabled: ready, retry: false, meta: INLINE_ERROR_META } as const;
  const due = useQuery({ ...trpc.maint.plans.due.queryOptions(), ...opts });
  const open = useQuery({ ...trpc.maint.workOrders.list.queryOptions({ status: "live", limit: 20 }), ...opts });
  const breakdowns = useQuery({ ...trpc.maint.workOrders.breakdowns.queryOptions(), ...opts });
  const flagged = useQuery({ ...trpc.maint.readings.flagged.queryOptions(), ...opts });

  const done = (wo: { id: string }) => {
    void qc.invalidateQueries(trpc.maint.pathFilter());
    void navigate({ to: "/maintenance/work-orders/$id", params: { id: wo.id } });
  };
  const onError = (e: unknown) => toast.error(t(maintErrorKey(e)));
  const fromPlan = useMutation({ ...trpc.maint.plans.makeWorkOrder.mutationOptions(), onSuccess: done, onError });
  const fromDowntime = useMutation({ ...trpc.maint.workOrders.fromDowntime.mutationOptions(), onSuccess: done, onError });
  const fromReading = useMutation({ ...trpc.maint.readings.makeWorkOrder.mutationOptions(), onSuccess: done, onError });

  const header = <PageHeader title={t("maint.title")} subtitle={t("maint.subtitle")} />;
  if (me.data && !maintenanceOn(me.data)) {
    return (
      <>
        {header}
        <EmptyState title={t("maint.moduleOff")} />
      </>
    );
  }
  if (me.data && !can(me.data, "maint.view")) {
    return (
      <>
        {header}
        <EmptyState title={t("maint.noAccess")} />
      </>
    );
  }

  const failed = [due, open, breakdowns, flagged].some((q) => q.isError && !q.data);
  const duePlans = (due.data ?? []).filter((p) => p.due.state !== "ok");
  const waitingBreakdowns = (breakdowns.data?.items ?? []).filter((b) => !b.workOrderId);
  const waitingReadings = (flagged.data ?? []).filter((r) => !r.workOrderId);
  const live = open.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t("maint.title")}
        subtitle={t("maint.subtitle")}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" asChild>
              <UiLink to="/maintenance/assets">{t("maint.home.assets")}</UiLink>
            </Button>
            <Button variant="secondary" asChild>
              <UiLink to="/maintenance/work-orders">{t("maint.home.workOrders")}</UiLink>
            </Button>
            <Button variant="secondary" asChild>
              <UiLink to="/maintenance/report">{t("maint.home.report")}</UiLink>
            </Button>
          </div>
        }
      />
      {failed ? <p className="m-0 text-[14px] font-medium text-destructive">{t("maint.loadFailed")}</p> : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section id="due" title={t("maint.home.dueTitle")}>
          {duePlans.length === 0 ? (
            <p className="m-0 text-[15px] text-muted-foreground">{t("maint.home.dueEmpty")}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {duePlans.map((p) => (
                <li key={p.planId} className={rowClass}>
                  <span className="min-w-0">
                    <UiLink to={`/maintenance/assets/${p.assetId}`} className="font-mono font-semibold">
                      {p.assetCode}
                    </UiLink>
                    <span className="ml-1.5">{p.title}</span>
                    <span className="block text-[13px] text-muted-foreground">{dueLines(p.due).map((l) => t(l.key, l.vars)).join(", ")}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {isDueState(p.due.state) ? (
                      <Chip tone={DUE_TONE[p.due.state]} truncate={false}>
                        {t(`maint.due.state.${p.due.state}`)}
                      </Chip>
                    ) : null}
                    {p.openWorkOrderId ? (
                      <UiLink to={`/maintenance/work-orders/${p.openWorkOrderId}`} className="text-[14px] font-semibold underline underline-offset-4">
                        {t("maint.home.openWorkOrder", { number: p.openWorkOrderNumber ?? "" })}
                      </UiLink>
                    ) : (
                      <Can do="maint.workorder">
                        <Button size="sm" variant="secondary" disabled={fromPlan.isPending} onClick={() => fromPlan.mutate({ planId: p.planId })}>
                          {t("maint.home.makeWorkOrder")}
                        </Button>
                      </Can>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="open" title={t("maint.home.openTitle")}>
          {live.length === 0 ? (
            <p className="m-0 text-[15px] text-muted-foreground">{t("maint.home.openEmpty")}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {live.map((w) => (
                <li key={w.id} className={rowClass}>
                  <span className="min-w-0">
                    <UiLink to={`/maintenance/work-orders/${w.id}`} className="font-mono font-semibold">
                      {w.number}
                    </UiLink>
                    <span className="ml-1.5 font-mono">{w.assetCode}</span>
                    <span className="block text-[13px] text-muted-foreground">{w.title}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {isPriority(w.priority) ? (
                      <Chip tone={PRIORITY_TONE[w.priority]} truncate={false}>
                        {t(`maint.priority.${w.priority}`)}
                      </Chip>
                    ) : null}
                    {isWoStatus(w.status) ? (
                      <Chip tone={WO_STATUS_TONE[w.status]} truncate={false}>
                        {t(`maint.woStatus.${w.status}`)}
                      </Chip>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="breakdowns" title={t("maint.home.breakdownsTitle")} hint={t("maint.home.breakdownsHint")}>
          {waitingBreakdowns.length === 0 ? (
            <p className="m-0 text-[15px] text-muted-foreground">{t("maint.home.breakdownsEmpty")}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {waitingBreakdowns.map((b) => (
                <li key={b.id} className={rowClass}>
                  <span className="min-w-0">
                    <span className="font-mono font-semibold">{b.lineCode}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {b.stoppedAt
                        ? t("maint.home.minutes", { min: Math.max(0, Math.round((b.stoppedAt - b.startedAt) / 60_000)) })
                        : t("maint.home.since", { time: whenText(fmt, b.startedAt) })}
                    </span>
                    {b.note ? <span className="block text-[13px] text-muted-foreground">{b.note}</span> : null}
                  </span>
                  {b.assetId ? (
                    <Can do="maint.workorder">
                      <Button size="sm" variant="secondary" disabled={fromDowntime.isPending} onClick={() => fromDowntime.mutate({ downtimeId: b.id })}>
                        {t("maint.home.makeWorkOrder")}
                      </Button>
                    </Can>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">{t("maint.home.noAsset")}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="flagged" title={t("maint.home.flaggedTitle")}>
          {waitingReadings.length === 0 ? (
            <p className="m-0 text-[15px] text-muted-foreground">{t("maint.home.flaggedEmpty")}</p>
          ) : (
            <ul className="m-0 list-none p-0">
              {waitingReadings.map((r) => (
                <li key={r.id} className={rowClass}>
                  <span className="min-w-0">
                    <UiLink to={`/maintenance/assets/${r.assetId}`} className="font-mono font-semibold">
                      {r.assetCode}
                    </UiLink>
                    <span className="ml-1.5">{r.kindName}</span>
                    <span className="ml-1.5 tabular-nums">
                      {milliText(r.valueMilli)} {r.unit}
                    </span>
                    <span className="block text-[13px] text-muted-foreground">{whenText(fmt, r.readAt)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    {isReadingFlag(r.flag) ? (
                      <Chip tone={FLAG_TONE[r.flag]} truncate={false}>
                        {t(`maint.flag.${r.flag}`)}
                      </Chip>
                    ) : null}
                    <Can do="maint.workorder">
                      <Button size="sm" variant="secondary" disabled={fromReading.isPending} onClick={() => fromReading.mutate({ readingId: r.id })}>
                        {t("maint.home.makeWorkOrder")}
                      </Button>
                    </Can>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
