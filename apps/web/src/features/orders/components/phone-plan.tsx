/**
 * FP-OP-21 (W4-NEXTROWS): the press plan and the day's press summary on the owner's phone,
 * read-only (`plans.phone`). Per die: lengths with planned vs pressed pcs/kg and a run-state chip.
 * Planning itself stays on the 11" and desktop board.
 */
import { formatLength as formatLengthMm, type PlanDieState } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";

import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";

import { dayTimeText, orderKgText } from "../format";
import { useCompanyTimeZone } from "../hooks";
import { DIE_STATE_TONE, dieStateKey, pressedBarWidth, pressedPctText, pressedVsPlanned } from "../phone-plan-view";

export function PhonePlan({ planId }: { planId?: string }) {
  return (
    <Can do="reports.read" fallback={<CanPlan planId={planId} />}>
      <PhonePlanBody planId={planId} />
    </Can>
  );
}

function CanPlan({ planId }: { planId?: string }) {
  return (
    <Can do="order.plan">
      <PhonePlanBody planId={planId} />
    </Can>
  );
}

function PhonePlanBody({ planId }: { planId?: string }) {
  const { t, locale } = useT();
  const zone = useCompanyTimeZone();
  const { unit } = useLengthUnit();
  const q = useQuery(trpc.plans.phone.queryOptions(planId ? { planId } : {}));
  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.isError || !q.data) {
    return (
      <div role="alert" className="rounded-card border border-border bg-card">
        <EmptyState title={t("press.summary.loadFailed")} />
      </div>
    );
  }
  const { plans, summary } = q.data;
  return (
    <div className="flex min-w-0 flex-col gap-4" data-phone-plan="">
      <Card data-phone-summary="">
        <CardHeader>
          <CardTitle>{t("press.summary.pressedToday")}</CardTitle>
        </CardHeader>
        <dl className="grid grid-cols-2 gap-3 px-4 pb-4 text-sm">
          <Tile label={t("press.summary.title")} value={t("press.summary.kg", { kg: orderKgText(summary.kgG) })} />
          <Tile label={t("press.summary.runs")} value={String(summary.runs)} />
          <Tile label={t("press.summary.recovery")} value={summary.runs > 0 && summary.recoveryBp !== null ? `${pressedPctText(summary.recoveryBp)}%` : "–"} />
          <Tile label={t("press.summary.downtime")} value={t("press.summary.minutes", { min: summary.downtimeMin })} />
        </dl>
        {summary.byLine.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border px-4 py-3 text-sm">
            {summary.byLine.map((l) => (
              <li key={l.pressLineId} className="flex min-w-0 justify-between gap-2">
                <span className="truncate">
                  {l.code} · {l.name}
                </span>
                <span className="shrink-0 tabular-nums">{t("press.summary.shiftRow", { runs: l.runs, kg: orderKgText(l.kgG) })}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Card>

      {plans.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("orders.phonePlan.none")} body={t("orders.phonePlan.noneBody")} />
        </div>
      ) : (
        plans.map((p) => (
          <Card key={p.id} data-phone-plan-card={p.number}>
            <CardHeader>
              <CardTitle>
                {p.number}
                {p.pressLine ? ` · ${p.pressLine.code}` : ""}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {t("press.plan.window", { from: dayTimeText(p.windowStart, locale, zone), to: dayTimeText(p.windowEnd, locale, zone) })}
              </p>
              <p className="text-sm tabular-nums">
                {t("orders.phonePlan.planTotal", { pressed: orderKgText(p.pressedG), planned: orderKgText(p.plannedG), pct: pressedPctText(p.pressedBp) })}
              </p>
            </CardHeader>
            <ul className="flex flex-col divide-y divide-border">
              {p.dies.map((d) => {
                const tot = pressedVsPlanned(d);
                return (
                  <li key={d.id} className="flex min-w-0 flex-col gap-2 px-4 py-3" data-phone-die={d.sectionCode} data-die-state={d.state}>
                    <div className="flex min-w-0 items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {d.sectionCode}
                        {d.sectionName ? ` · ${d.sectionName}` : ""}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        {d.urgent ? (
                          <Chip tone="red" truncate={false}>
                            {t("orders.phonePlan.urgent")}
                          </Chip>
                        ) : null}
                        <Chip tone={DIE_STATE_TONE[d.state as PlanDieState]} truncate={false} data-die-chip="">
                          {t(dieStateKey(d.state as PlanDieState) as MessageKey)}
                        </Chip>
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full bg-primary" style={{ width: pressedBarWidth(d.pressedBp) }} />
                    </div>
                    <p className="text-sm tabular-nums">
                      {t("orders.phonePlan.kgLine", { pressed: tot.kg.pressed, planned: tot.kg.planned })}
                      {tot.pcs ? ` · ${t("orders.phonePlan.pcsLine", { pressed: tot.pcs.pressed, planned: tot.pcs.planned })}` : ""}
                    </p>
                    <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
                      {d.lengths.map((l) => {
                        const r = pressedVsPlanned(l);
                        return (
                          <li key={l.cutLengthMm} className="flex min-w-0 justify-between gap-2 tabular-nums" data-phone-length="">
                            <span>{formatLengthMm(l.cutLengthMm, unit)}</span>
                            <span className="text-right">
                              {t("orders.phonePlan.kgLine", { pressed: r.kg.pressed, planned: r.kg.planned })}
                              {r.pcs ? ` · ${t("orders.phonePlan.pcsLine", { pressed: r.pcs.pressed, planned: r.pcs.planned })}` : ""}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))
      )}
      <p className="text-sm text-muted-foreground">{t("orders.phonePlan.readOnly")}</p>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="truncate text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
