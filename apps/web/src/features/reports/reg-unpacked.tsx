import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { dateText, kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { unpackedCsv } from "./reg-model";
import { Dash, RegEmpty, RegLoadFailed, RegLoading } from "./reg-shared";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

/** `/reports/unpacked` (#96): released from ageing and not packed yet, per section and die copy. */
export function UnpackedReport() {
  return (
    <ReportsGate>
      <Body />
    </ReportsGate>
  );
}

function Body() {
  const { t } = useT();
  const fmt = useFmt();
  const query = useQuery({ ...trpc.reports.unpacked.queryOptions({}), meta: INLINE_ERROR_META });
  const data = query.data;
  const kg = (g: number) => kgGrouped3(fmt, g);
  const unit = massUnit(fmt);
  const dateOf = (ms: number) => dateText(fmt, ms);

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.unpacked.title")}
        subtitle={t("reg.reports.unpacked.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (data ? { name: csvFileName(t("reg.reports.unpacked.csvName")), text: unpackedCsv(data, dateOf, t) } : null)} />
          </div>
        }
      />
      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !data ? (
        <RegLoading />
      ) : data.rows.length === 0 ? (
        <RegEmpty title={t("reg.reports.unpacked.empty")} />
      ) : (
        <ReportTableFrame label={t("reg.reports.unpacked.title")}>
          <table data-testid="unpacked-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
            <caption className="sr-only">{t("reg.reports.unpacked.title")}</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className={TH}>
                  {t("reg.reports.col.section")}
                </th>
                <th scope="col" className={TH}>
                  {t("reg.reports.col.copy")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.trolleyLines")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.pieces")}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.weight", { massUnit: unit })}
                </th>
                <th scope="col" className={`${TH} text-right`}>
                  {t("reg.reports.col.oldest")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.sectionId}-${r.copyId ?? ""}`} className="border-b border-border last:border-0">
                  <th scope="row" className={`${TD} font-medium`}>
                    {r.sectionCode}
                  </th>
                  <td className={TD}>{r.copyCode ?? <Dash />}</td>
                  <td className={`${TD} ${NUM}`}>{r.lines}</td>
                  <td className={`${TD} ${NUM}`}>{r.pcs}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.kgG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{r.oldestReleasedAt == null ? <Dash /> : dateOf(r.oldestReleasedAt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold" data-testid="unpacked-totals">
                <th scope="row" colSpan={2} className={TD}>
                  {t("reports.total")}
                </th>
                <td className={`${TD} ${NUM}`}>{data.totals.lines}</td>
                <td className={`${TD} ${NUM}`}>{data.totals.pcs}</td>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(data.totals.kgG)}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </table>
        </ReportTableFrame>
      )}
    </>
  );
}
