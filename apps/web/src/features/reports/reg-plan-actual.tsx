import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { achievedText, downtimeReasonText, planActualCsv, planActualGroupKey } from "./reg-model";
import { PLAN_ACTUAL_GROUP_KEYS, type PlanActualSearch } from "./reg-search";
import { Dash, RegEmpty, RegLoadFailed, RegLoading, RegRangeFields, useRegRange } from "./reg-shared";
import { NUM, ReportActions, ReportPrintContext, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

/** `/reports/plan-actual` (#53): planned kg of released plans against the good kg of their logged runs. */
export function PlanActualReport({ search, onSearch }: { search: PlanActualSearch; onSearch: (next: PlanActualSearch) => void }) {
  return (
    <ReportsGate>
      <Body search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function Body({ search, onSearch }: { search: PlanActualSearch; onSearch: (next: PlanActualSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const range = useRegRange(search);
  const group = search.group ?? "press";
  const input = range ? { ...range, groupBy: group } : null;
  const query = useQuery({
    ...trpc.reports.planActual.queryOptions(input ?? { from: "2000-01-01", to: "2000-01-01", groupBy: group }),
    enabled: input !== null,
    meta: INLINE_ERROR_META,
  });
  const data = query.data;
  const kg = (g: number) => kgGrouped3(fmt, g);
  const unit = massUnit(fmt);
  const pct = (bp: number | null) => (bp == null ? <Dash /> : `${achievedText(bp)}%`);

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.planActual.title")}
        subtitle={t("reg.reports.planActual.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (data && input ? { name: csvFileName(t("reg.reports.planActual.csvName"), input.from, input.to), text: planActualCsv(data, t) } : null)} />
          </div>
        }
      />
      <ReportPrintContext parts={[range ? `${range.from} - ${range.to}` : null, t(planActualGroupKey(group))]} />
      <div className="report-no-print grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("common.filter")}>
        <RegRangeFields search={search} range={range} onSearch={onSearch} />
        <SegmentedControl
          label={t("reg.reports.planActual.groupBy")}
          value={group}
          onChange={(v) => onSearch({ ...search, group: v === "press" ? undefined : v })}
          options={PLAN_ACTUAL_GROUP_KEYS.map((g) => ({ value: g, label: t(planActualGroupKey(g)) }))}
        />
      </div>

      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !data ? (
        <RegLoading />
      ) : data.rows.length === 0 ? (
        <RegEmpty title={t("reg.reports.planActual.empty")} />
      ) : (
        <ReportTableFrame label={t("reg.reports.planActual.title")}>
          <table data-testid="plan-actual-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
            <caption className="sr-only">{t("reg.reports.planActual.title")}</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className={TH}>
                  {t(planActualGroupKey(data.groupBy))}
                </th>
                {(["planned", "actual", "gap"] as const).map((k) => (
                  <th key={k} scope="col" className={`${TH} text-right`}>
                    {t(`reg.reports.col.${k}`, { massUnit: unit })}
                  </th>
                ))}
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.achieved")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.downtime")}
                </th>
                <th scope="col" className={TH}>
                  {t("reg.reports.col.topReasons")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0">
                  <th scope="row" className={`${TD} font-medium`}>
                    {r.label || t("reg.reports.planActual.notSet")}
                  </th>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.plannedG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.actualG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.gapG)}</td>
                  <td className={`${TD} ${NUM}`}>{pct(r.achievedBp)}</td>
                  <td className={`${TD} ${NUM}`}>{r.downtimeMin === 0 ? <Dash /> : r.downtimeMin}</td>
                  <td className={TD}>
                    {r.reasons.length === 0 ? (
                      <Dash />
                    ) : (
                      <ul className="m-0 list-none p-0">
                        {r.reasons.slice(0, 3).map((x) => (
                          <li key={x.code}>{downtimeReasonText(x, t)}</li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold" data-testid="plan-actual-totals">
                <th scope="row" className={TD}>
                  {t("reports.total")}
                </th>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(data.totals.plannedG)}</td>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(data.totals.actualG)}</td>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(data.totals.gapG)}</td>
                <td className={`${TD} ${NUM}`}>{pct(data.totals.achievedBp)}</td>
                <td className={`${TD} ${NUM}`}>{data.totals.downtimeMin}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </table>
        </ReportTableFrame>
      )}
    </>
  );
}
