import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { AGE_BUCKET_KEYS, csvFileName, kgText, stockAgeCsv, stockAgeRowName } from "./model";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";
import type { StockAgeSearch } from "./search";

const StockAgeChart = lazy(() => import("./report-charts").then((m) => ({ default: m.StockAgeChart })));

/**
 * `/reports/stock-age` (FP-PK-16): available bundles by days since packing, 0-7 / 8-30 / 31-90 /
 * over 90, one row per party and one for plant stock, kg and bundles (`analytics.stockAge`).
 */
export function StockAgeReport({ search, onSearch }: { search: StockAgeSearch; onSearch: (next: StockAgeSearch) => void }) {
  return (
    <ReportsGate>
      <StockAgeBody search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function StockAgeBody({ search, onSearch }: { search: StockAgeSearch; onSearch: (next: StockAgeSearch) => void }) {
  const { t } = useT();
  const input = search.plant ? { plantOnly: true } : search.party ? { customerId: search.party } : {};
  const query = useQuery({ ...trpc.analytics.stockAge.queryOptions(input), meta: INLINE_ERROR_META });
  const data = query.data;

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reports.stockAge.title")}
        subtitle={t("reports.stockAge.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (data ? { name: csvFileName(t("reports.stockAge.csvName"), data.today), text: stockAgeCsv(data, t) } : null)} />
          </div>
        }
      />
      <div className="report-no-print flex flex-wrap items-center gap-3">
        <SegmentedControl
          label={t("reports.stockAge.show")}
          value={search.plant ? "plant" : "all"}
          onChange={(v) => onSearch(v === "plant" ? { plant: true } : {})}
          options={[
            { value: "all", label: t("reports.stockAge.all") },
            { value: "plant", label: t("reports.stockAge.plantOnly") },
          ]}
        />
      </div>

      {showsQueryError(query) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : data.totals.bundles === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("reports.stockAge.empty")} />
        </div>
      ) : (
        <>
          <p className="m-0 text-[14px] text-muted-foreground">{t("reports.stockAge.asOf", { date: data.today })}</p>
          <ReportTableFrame label={t("reports.stockAge.title")}>
            <table data-testid="stock-age-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reports.stockAge.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className={TH}>
                    {t("reports.stockAge.party")}
                  </th>
                  {AGE_BUCKET_KEYS.map((k) => (
                    <th key={k} scope="col" className={`${TH} text-right`}>
                      {t(k)}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reports.total")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.customerId ?? "plant"} className="border-b border-border last:border-0" data-party={r.customerId ?? "plant"}>
                    <th scope="row" className={`${TD} min-w-[9rem] font-medium`}>
                      {stockAgeRowName(r, t)}
                    </th>
                    {r.buckets.map((c, i) => (
                      <td key={i} className={`${TD} ${NUM} whitespace-nowrap`}>
                        <AgeCell kgG={c.kgG} bundles={c.bundles} />
                      </td>
                    ))}
                    <td className={`${TD} ${NUM} whitespace-nowrap font-semibold`}>
                      <AgeCell kgG={r.kgG} bundles={r.bundles} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold" data-testid="stock-age-totals">
                  <th scope="row" className={TD}>
                    {t("reports.total")}
                  </th>
                  {data.buckets.map((b) => (
                    <td key={b.key} className={`${TD} ${NUM} whitespace-nowrap`} data-bucket={b.key}>
                      <AgeCell kgG={b.kgG} bundles={b.bundles} />
                    </td>
                  ))}
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>
                    <AgeCell kgG={data.totals.kgG} bundles={data.totals.bundles} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </ReportTableFrame>
          <Can do="analytics.view">
            <div className="report-no-print">
              <Suspense fallback={<Skeleton className="h-56 rounded-card" />}>
                <StockAgeChart data={data} />
              </Suspense>
            </div>
          </Can>
        </>
      )}
    </>
  );
}

/** "1,220.000 kg" over "8 bundles"; an empty cell is a quiet dash. */
function AgeCell({ kgG, bundles }: { kgG: number; bundles: number }) {
  const { t } = useT();
  if (bundles === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end">
      <span>
        {kgText(kgG)} {t("reports.stockAge.kg")}
      </span>
      <span className="text-[12px] text-muted-foreground">{t("reports.stockAge.bundleCount", { count: bundles })}</span>
    </span>
  );
}
