import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { ReportScreen } from "../press/report-view";
import { csvFileName, kgText, RECOVERY_GROUPS, recoveryCsv, recoveryLabel, type RecoveryGroup } from "./model";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";
import type { ProductionSearch } from "./search";

// The chart kit (and d3) loads only when an analytics.view role opens the page.
const RecoveryChart = lazy(() => import("./report-charts").then((m) => ({ default: m.RecoveryChart })));

/**
 * `/reports/production`: the press report (17 columns, the same filters, CSV and print as
 * `/press/report`) followed by recovery by die / copy / press / shift for the same days and filters
 * (`analytics.recovery`, production runs only).
 */
export function ProductionReport({ search, onSearch }: { search: ProductionSearch; onSearch: (next: ProductionSearch) => void }) {
  const { t } = useT();
  return (
    <ReportsGate>
      <ReportPrintStyle />
      <ReportScreen
        search={search}
        onSearch={(next) => onSearch({ ...next, ...(search.group ? { group: search.group } : {}) })}
        title={t("reports.production.title")}
        subtitle={t("reports.production.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
      >
        <RecoveryPanel search={search} onSearch={onSearch} />
      </ReportScreen>
    </ReportsGate>
  );
}

function RecoveryPanel({ search, onSearch }: { search: ProductionSearch; onSearch: (next: ProductionSearch) => void }) {
  const { t } = useT();
  // Same default day as the report above (the current production day); same cached query.
  const today = useQuery({ ...trpc.press.summary.queryOptions({}), meta: INLINE_ERROR_META });
  const from = search.from ?? search.to ?? today.data?.productionDay;
  const to = search.to ?? search.from ?? today.data?.productionDay;
  const group: RecoveryGroup = search.group ?? "die";
  const input =
    from && to
      ? { from, to, groupBy: group, ...(search.shift ? { shiftSeq: search.shift } : {}), ...(search.line ? { pressLineId: search.line } : {}), ...(search.plan ? { planId: search.plan } : {}) }
      : null;
  const query = useQuery({
    ...trpc.analytics.recovery.queryOptions(input ?? { from: "2000-01-01", to: "2000-01-01", groupBy: group }),
    enabled: input !== null,
    meta: INLINE_ERROR_META,
  });
  const data = query.data;

  return (
    <section aria-labelledby="recovery-title" className="flex min-w-0 flex-col gap-3" data-testid="recovery-summary">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="recovery-title" className="m-0 text-[17px] font-semibold">
            {t("reports.production.recoveryTitle")}
          </h2>
          <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("reports.production.recoveryNote")}</p>
        </div>
        <div className="report-no-print flex flex-wrap items-center gap-2">
          <SegmentedControl
            label={t("reports.production.groupBy")}
            value={group}
            onChange={(v) => onSearch({ ...search, group: v === "die" ? undefined : v })}
            options={RECOVERY_GROUPS.map((g) => ({ value: g, label: t(`reports.production.group.${g}`) }))}
          />
          <ReportActions
            csv={() => (data && input ? { name: csvFileName(t("reports.production.csvName"), input.from, input.to), text: recoveryCsv(data, t) } : null)}
          />
        </div>
      </div>

      {showsQueryError(query) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !data ? (
        <Skeleton className="h-32 rounded-card" />
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("reports.production.empty")} />
        </div>
      ) : (
        <>
          <ReportTableFrame label={t("reports.production.recoveryTitle")}>
            <table data-testid="recovery-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reports.production.recoveryTitle")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className={TH}>
                    {t(`reports.production.group.${group}`)}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.production.runs")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.production.input")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.production.good")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.production.scrap")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.production.recovery")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key || "none"} className="border-b border-border last:border-0" data-key={r.key}>
                    <th scope="row" className={`${TD} min-w-[8rem] font-medium`}>
                      {recoveryLabel(r, group, t)}
                    </th>
                    <td className={`${TD} ${NUM}`}>{r.runs}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.inputG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.goodG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.scrapG)}</td>
                    <td className={`${TD} ${NUM} font-semibold`}>{r.recoveryPct ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold" data-testid="recovery-totals">
                  <th scope="row" className={TD}>
                    {t("reports.total")}
                  </th>
                  <td className={`${TD} ${NUM}`}>{data.totals.runs}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.totals.inputG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.totals.goodG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.totals.scrapG)}</td>
                  <td className={`${TD} ${NUM}`}>{data.totals.recoveryPct ?? "—"}</td>
                </tr>
              </tfoot>
            </table>
          </ReportTableFrame>
          <Can do="analytics.view">
            <div className="report-no-print">
              <Suspense fallback={<Skeleton className="h-56 rounded-card" />}>
                <RecoveryChart data={data} />
              </Suspense>
            </div>
          </Can>
        </>
      )}
    </section>
  );
}
