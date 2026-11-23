/**
 * "Billets for this plan" (#49): the billet need of a press plan by alloy and length against the
 * billet stock, and the readiness chip of each plan line. Office screen, order.plan or reports.read.
 */
import { bpPercent1 } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Card, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { canAny, useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { BILLET_DOT_KEY, BILLET_DOT_TONE, billetDot, recoveryKey, totalIsShort, type BilletLineState } from "./plan-billets-model";

/** The billet need of a plan; one query shared by the card and the line chips. Off for a user who may not read it. */
export function usePlanBillets(planId: string) {
  const { data: me } = useMe();
  const allowed = canAny(me, ["order.plan", "reports.read"]);
  return useQuery({
    ...trpc.reports.billetNeed.queryOptions({ planId }),
    enabled: allowed,
    meta: INLINE_ERROR_META,
  });
}

/** Dot and words of one plan line. The words always show, so colour is never the only signal. */
export function PlanLineReadiness({ row, alloy }: { row: BilletLineState; alloy: string | null }) {
  const { t } = useT();
  const state = billetDot(row);
  const text =
    state === "ready"
      ? t("reg.billet.ready")
      : state === "dieNotReady"
        ? t("reg.billet.dieNotReady")
        : t("reg.billet.billetsShort", { alloy: alloy ?? t("reg.billet.noAlloy") });
  return (
    <Chip tone={BILLET_DOT_TONE[state]} truncate={false} data-billet-dot={state} aria-label={`${t("reg.billet.readyLabel")}: ${text}`}>
      {text}
    </Chip>
  );
}

export function PlanBilletsCard({ planId }: { planId: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const { data: me } = useMe();
  const q = usePlanBillets(planId);
  if (!canAny(me, ["order.plan", "reports.read"])) return null;
  const unit = massUnit(fmt);
  const percent = (bp: number) => `${bpPercent1(bp)}%`;
  return (
    <Card data-plan-billets="">
      <CardHeader>
        <CardTitle>{t("reg.billet.title")}</CardTitle>
      </CardHeader>
      <div className="flex min-w-0 flex-col gap-3">
        <p className="m-0 text-[13px] text-muted-foreground">{t("reg.billet.hint")}</p>
        {q.isError ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {t("reg.billet.loadFailed")}
          </p>
        ) : !q.data ? null : (
          <>
            {q.data.totals.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-[13px] leading-5">
                  <caption className="sr-only">{t("reg.billet.title")}</caption>
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className="px-3 py-2 font-medium">{t("reg.billet.alloy")}</th>
                      <th scope="col" className="px-3 py-2 font-medium">{t("reg.billet.length")}</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.billet.needKg")} ({unit})</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.billet.count")}</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">{t("reg.billet.stockKg")} ({unit})</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.totals.map((r) => {
                      const short = totalIsShort(r);
                      return (
                        <tr key={`${r.alloy ?? ""}|${r.billetLengthMm ?? ""}`} className="border-b border-border last:border-0" data-billet-total={r.alloy ?? ""} data-short={short ? "" : undefined}>
                          <td className="px-3 py-2">{r.alloy ?? t("reg.billet.noAlloy")}</td>
                          <td className="px-3 py-2 tabular-nums">{r.billetLengthMm == null ? t("reg.billet.unknownLength") : fmt.q("bundle.length", r.billetLengthMm)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{kgGrouped3(fmt, r.billetKgG)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{r.billets ?? "-"}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="inline-flex flex-wrap items-center justify-end gap-2">
                              <span className="font-mono tabular-nums">{kgGrouped3(fmt, r.stockG)}</span>
                              {short ? (
                                <Chip tone="amber" truncate={false}>
                                  {t("reg.billet.billetsShort", { alloy: r.alloy ?? t("reg.billet.noAlloy") })}
                                </Chip>
                              ) : null}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {q.data.rows.map((r) => (
                <li key={r.planLineId} data-billet-line={r.planLineId} className="text-[13px] leading-5 text-muted-foreground">
                  <span className="font-mono tabular-nums text-foreground">{r.sectionCode}</span>
                  {r.soNumber ? ` ${r.soNumber}` : ""} · {t(recoveryKey(r.recoverySource), { pct: percent(r.recoveryBp) })}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Card>
  );
}
