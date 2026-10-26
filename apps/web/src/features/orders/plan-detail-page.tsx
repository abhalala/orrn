/**
 * `/orders/plan/$id`: one press plan (desktop and 11" only). A draft is released to the press
 * (window at most 24 hours; one queued run per die). The other parties' open lines on the same
 * die come back from the release as notes, never as a refusal; an over-plan is the server's
 * CONFLICT, worded here.
 */
import { formatLength as formatLengthMm } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { OtherLines } from "./components/other-lines";
import { PlanPrintButtons } from "./components/print-buttons";
import { PhonePlan } from "./components/phone-plan";
import { ReasonSheet } from "./components/reason-sheet";
import { orderErrorLines } from "./errors";
import { dayTimeText, orderKgText } from "./format";
import { useCompanyTimeZone, useMinWidth } from "./hooks";
import { BiggerScreenNote, PLAN_STATUS_TONE } from "./plan-board-page";
import { dieTitle } from "./view";

type Warning = { lineId: string; sectionCode: string; customerName: string; orderNumber: string; cutLengthMm: number; planableG: number };

export function PlanDetailPage({ id }: { id: string }) {
  const { t, locale } = useT();
  const zone = useCompanyTimeZone();
  const queryClient = useQueryClient();
  const { unit } = useLengthUnit();
  const wide = useMinWidth(820);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);

  const plan = useQuery(trpc.plans.get.queryOptions({ id }));
  const pressLines = useQuery(trpc.plans.pressLines.queryOptions());
  const isDraft = plan.data?.plan.status === "draft";
  const isProduction = (plan.data?.plan.purpose ?? "production") === "production";
  const dieIds = (plan.data?.dies ?? []).map((d) => d.sectionId);
  // FP-OP-15 / rank 30 on a draft: every other open line on its dies, added in one tap (plans.update).
  const others = useQuery({
    ...trpc.plans.openLinesForDies.queryOptions({ dieIds, planId: id }),
    enabled: isDraft && isProduction && dieIds.length > 0,
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.plans.get.queryKey({ id }) }),
      queryClient.invalidateQueries({ queryKey: trpc.plans.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.plans.candidates.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.orders.get.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.plans.openLinesForDies.queryKey() }),
    ]);

  const change = useMutation({
    mutationFn: (input: { add?: { salesOrderLineId: string }[]; remove?: string[] }) =>
      trpcClient.plans.update.mutate({ id, serverSeq: plan.data!.plan.serverSeq, ...input }),
    onSuccess: async (_res, input) => {
      setErrors([]);
      toast.success(input.add?.length ? t("orders.plan.added") : t("orders.plan.removed"));
      await refresh();
    },
    onError: async (error) => {
      setErrors(orderErrorLines(t, error));
      await refresh();
    },
  });

  const release = useMutation({
    mutationFn: () => trpcClient.plans.release.mutate({ id }),
    onSuccess: async (res) => {
      setErrors([]);
      setReleaseOpen(false);
      setWarnings(
        res.warnings.map((w) => ({
          lineId: w.lineId,
          sectionCode: w.sectionCode,
          customerName: w.customerName,
          orderNumber: w.orderNumber,
          cutLengthMm: w.cutLengthMm,
          planableG: w.planableG,
        })),
      );
      toast.success(t("orders.plan.released"));
      await refresh();
    },
    onError: async (error) => {
      setErrors(orderErrorLines(t, error));
      await refresh();
    },
  });
  const cancel = useMutation({
    mutationFn: (reason: string) => trpcClient.plans.cancel.mutate({ id, ...(reason ? { reason } : {}) }),
    onSuccess: async () => {
      setErrors([]);
      setCancelOpen(false);
      toast.success(t("orders.plan.cancelled"));
      await refresh();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });
  const close = useMutation({
    mutationFn: () => trpcClient.plans.close.mutate({ id }),
    onSuccess: async () => {
      setErrors([]);
      toast.success(t("orders.plan.closed"));
      await refresh();
    },
    onError: (error) => setErrors(orderErrorLines(t, error)),
  });

  const back = { to: "/orders/plan", label: t("press.plan.title") };
  if (!wide) {
    return (
      <>
        <PageHeader title={t("press.plan.title")} back={back} />
        <div className="flex min-w-0 flex-col gap-4">
          <PhonePlan planId={id} />
          <BiggerScreenNote />
        </div>
      </>
    );
  }
  if (plan.isError && plan.data === undefined) {
    return (
      <>
        <PageHeader title={t("press.plan.title")} back={back} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState title={t("orders.plan.notFound")} />
        </div>
      </>
    );
  }
  if (!plan.data) {
    return (
      <>
        <PageHeader title={t("press.plan.title")} back={back} />
        <Skeleton className="h-40 w-full" />
      </>
    );
  }

  const { plan: p, dies, lines, runs } = plan.data;
  const pl = (pressLines.data ?? []).find((x) => x.id === p.pressLineId);
  const pressLineText = pl ? `${pl.code} ${pl.name}` : null;
  const label = (mm: number) => formatLengthMm(mm, unit);
  const draft = p.status === "draft";

  return (
    <>
      <PageHeader
        title={p.number}
        subtitle={t("press.plan.window", { from: dayTimeText(p.windowStart, locale, zone), to: dayTimeText(p.windowEnd, locale, zone) })}
        back={back}
        actions={
          <Can do="order.plan">
            {draft ? (
              <Button size="lg" onClick={() => (setErrors([]), setReleaseOpen(true))}>
                {t("press.plan.release")}
              </Button>
            ) : null}
            {p.status === "released" ? (
              <Button variant="secondary" onClick={() => close.mutate()} disabled={close.isPending}>
                {t("press.plan.close")}
              </Button>
            ) : null}
            {draft || p.status === "released" ? (
              <Button variant="ghost" onClick={() => (setErrors([]), setCancelOpen(true))}>
                {t("press.plan.cancel")}
              </Button>
            ) : null}
          </Can>
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <PlanPrintButtons data={plan.data} pressLine={pressLineText} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={PLAN_STATUS_TONE[p.status]} truncate={false} data-plan-status={p.status}>
            {t(`press.plan.status.${p.status}`)}
          </Chip>
          {p.purpose !== "production" ? (
            <Chip tone="blue" truncate={false} data-plan-purpose={p.purpose}>
              {t(`press.plan.purpose.${p.purpose}`)}
            </Chip>
          ) : null}
          {draft ? <span className="text-[13px] text-muted-foreground">{t("orders.plan.windowHint")}</span> : null}
        </div>
        {p.purpose !== "production" && p.note ? (
          <p data-plan-note="" className="m-0 text-[14px] leading-6">
            <span className="text-muted-foreground">{t("orders.plan.trial.note")}: </span>
            <span className="font-mono tabular-nums">{p.note}</span>
          </p>
        ) : null}

        {errors.length > 0 && !cancelOpen ? (
          <div role="alert" data-plan-error="" className="flex flex-col gap-1 rounded-card border border-destructive/40 px-4 py-3">
            {errors.map((e) => (
              <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                {e}
              </p>
            ))}
          </div>
        ) : null}

        {warnings.length > 0 ? (
          <section data-plan-warnings="" className="flex flex-col gap-1 rounded-card border border-border bg-surface-sunken px-4 py-3">
            <h2 className="m-0 text-[14px] font-semibold">{t("orders.plan.warningsTitle")}</h2>
            {warnings.map((w) => (
              <p key={w.lineId} data-plan-warning={w.orderNumber} className="m-0 text-[14px] leading-5">
                {t("orders.plan.otherParty", {
                  die: w.sectionCode,
                  customer: w.customerName,
                  order: w.orderNumber,
                  length: label(w.cutLengthMm),
                  kg: orderKgText(w.planableG),
                })}
              </p>
            ))}
          </section>
        ) : null}

        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {dies.map((d, index) => {
            const run = runs.find((r) => r.pressPlanDieId === d.id);
            return (
              <li key={d.id} data-plan-die={d.sectionCode}>
                <Card>
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
                    <CardTitle className="font-mono tabular-nums">
                      {index + 1}. {dieTitle({ sectionCode: d.sectionCode, sectionName: d.sectionName })}
                    </CardTitle>
                    <span className="flex flex-wrap items-center gap-2">
                      {d.urgent ? (
                        <Chip tone="red" truncate={false}>
                          {t("press.plan.urgent")}
                        </Chip>
                      ) : null}
                      {run ? (
                        <Chip tone="blue" truncate={false} data-run={run.number}>
                          {run.number} · {t(`press.console.status.${run.status}`)}
                        </Chip>
                      ) : null}
                    </span>
                  </CardHeader>
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {lines
                      .filter((l) => l.pressPlanDieId === d.id)
                      .map((l) => (
                        <li key={l.id} data-plan-line={l.orderNumber} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                          <div className="min-w-0">
                            <p className="m-0 text-[14px] leading-5 break-words">
                              {l.customerName}
                              {l.poNumber ? ` · ${l.poNumber}` : ""}
                            </p>
                            <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                              {l.orderNumber} · {label(l.cutLengthMm)} · {orderKgText(l.kgG)} {t("units.kg")}
                            </p>
                          </div>
                          {draft && lines.length > 1 ? (
                            <Can do="order.plan">
                              <Button variant="ghost" disabled={change.isPending} onClick={() => change.mutate({ remove: [l.salesOrderLineId] })}>
                                {t("common.remove")}
                              </Button>
                            </Can>
                          ) : null}
                        </li>
                      ))}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>

        {draft && isProduction ? (
          <OtherLines
            rows={others.data?.lines ?? []}
            loading={others.isPending}
            failed={others.isError}
            more={others.data?.more ?? false}
            formatLength={label}
            addingId={change.isPending ? (change.variables?.add?.[0]?.salesOrderLineId ?? null) : null}
            onAdd={(row) => change.mutate({ add: [{ salesOrderLineId: row.lineId }] })}
          />
        ) : null}
      </div>

      <Sheet
        open={releaseOpen}
        onOpenChange={setReleaseOpen}
        title={t("orders.plan.releaseTitle", { number: p.number })}
        description={t("orders.plan.releaseHint")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setReleaseOpen(false)}>
              {t("common.back")}
            </Button>
            <Button onClick={() => release.mutate()} disabled={release.isPending}>
              {release.isPending ? t("common.saving") : t("orders.plan.releaseNow")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {dies.map((d, index) => (
            <section key={d.id} className="flex min-w-0 flex-col gap-1">
              <h3 className="m-0 font-mono text-[15px] font-semibold tabular-nums">
                {index + 1}. {d.sectionCode}
                {d.urgent ? ` · ${t("press.plan.urgent")}` : ""}
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {lines
                  .filter((l) => l.pressPlanDieId === d.id)
                  .map((l) => (
                    <li key={l.id} className="text-[14px] leading-5">
                      {l.customerName} · {l.orderNumber} · {label(l.cutLengthMm)} · {orderKgText(l.kgG)} {t("units.kg")}
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          {errors.length > 0 ? (
            <div role="alert" className="flex flex-col gap-1">
              {errors.map((e) => (
                <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                  {e}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      </Sheet>
      <ReasonSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t("press.plan.cancel")}
        label={t("common.reason")}
        submitLabel={t("press.plan.cancel")}
        required={false}
        busy={cancel.isPending}
        errors={cancelOpen ? errors : []}
        onSubmit={(reason) => cancel.mutate(reason)}
      />
    </>
  );
}
