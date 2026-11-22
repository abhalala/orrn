import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { bundleDetailPath } from "@/shared/lib/paths";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { collectPages, recutsCsv } from "./reg-model";
import type { RecutsSearch } from "./reg-search";
import { Dash, RegEmpty, RegLoadFailed, RegLoading, RegPager, RegRangeFields, RegStat, useRegRange } from "./reg-shared";
import { NUM, ReportActions, ReportPrintContext, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

const PAGE = 100;

/** `/reports/recuts` (#31): bundles cut shorter than their trolley line, with the reason and the kg lost. */
export function RecutsReport({ search, onSearch }: { search: RecutsSearch; onSearch: (next: RecutsSearch) => void }) {
  return (
    <ReportsGate>
      <Body search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function Body({ search, onSearch }: { search: RecutsSearch; onSearch: (next: RecutsSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const range = useRegRange(search);
  const base = range ? { ...range, ...(search.section ? { sectionId: search.section } : {}) } : null;
  const query = useInfiniteQuery({
    queryKey: [...trpc.reports.recuts.queryKey(base ?? { from: "2000-01-01", to: "2000-01-01" }), "pages"],
    queryFn: ({ pageParam }) => trpcClient.reports.recuts.query({ ...base!, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: base !== null,
    meta: INLINE_ERROR_META,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.rows);
  const kg = (g: number) => kgGrouped3(fmt, g);
  const unit = massUnit(fmt);

  const csv = async () => {
    if (!base) return null;
    const all = await collectPages((offset) => trpcClient.reports.recuts.query({ ...base, limit: 500, offset }));
    const totals = first?.totals ?? (await trpcClient.reports.recuts.query({ ...base, limit: 1, offset: 0 })).totals;
    return { name: csvFileName(t("reg.reports.recuts.csvName"), base.from, base.to), text: recutsCsv(all, totals, t) };
  };

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.recuts.title")}
        subtitle={t("reg.reports.recuts.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={csv} />
          </div>
        }
      />
      <ReportPrintContext parts={[range ? `${range.from} - ${range.to}` : null]} />
      <div className="report-no-print grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("common.filter")}>
        <RegRangeFields search={search} range={range} onSearch={onSearch} />
      </div>

      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !first ? (
        <RegLoading />
      ) : first.totals.bundles === 0 ? (
        <RegEmpty title={t("reg.reports.recuts.empty")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="recuts-totals">
            <RegStat label={t("reg.reports.col.bundles")}>{first.totals.bundles}</RegStat>
            <RegStat label={t("reg.reports.col.pieces")}>{first.totals.pcs}</RegStat>
            <RegStat label={t("reg.reports.col.weight", { massUnit: unit })}>{kg(first.totals.weightG)}</RegStat>
            <RegStat label={t("reg.reports.col.kgLost", { massUnit: unit })}>{kg(first.totals.lossG)}</RegStat>
          </div>
          <ReportTableFrame label={t("reg.reports.recuts.title")}>
            <table data-testid="recuts-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reg.reports.recuts.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {(["day", "bundle", "section", "copy"] as const).map((k) => (
                    <th key={k} scope="col" className={TH}>
                      {t(`reg.reports.col.${k}`)}
                    </th>
                  ))}
                  {(["trolleyLength", "cutLength", "pieces"] as const).map((k) => (
                    <th key={k} scope="col" className={`${TH} text-right`}>
                      {t(`reg.reports.col.${k}`)}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.weight", { massUnit: unit })}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.kgLost", { massUnit: unit })}
                  </th>
                  <th scope="col" className={TH}>
                    {t("reg.reports.col.reason")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.bundleId} className="border-b border-border last:border-0">
                    <td className={`${TD} whitespace-nowrap`}>{r.day}</td>
                    <td className={`${TD} font-mono`}>
                      <UiLink to={bundleDetailPath({ serial: r.serial })} className="underline underline-offset-4">
                        {r.serial}
                      </UiLink>
                    </td>
                    <td className={TD}>{r.sectionCode}</td>
                    <td className={TD}>{r.copyCode ?? <Dash />}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{r.fromLengthMm == null ? <Dash /> : fmt.q("bundle.length", r.fromLengthMm)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{fmt.q("bundle.length", r.lengthMm)}</td>
                    <td className={`${TD} ${NUM}`}>{r.pcs}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.weightG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.lossG)}</td>
                    <td className={TD}>{r.reason ? r.reason : <Dash />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <th scope="row" colSpan={6} className={TD}>
                    {t("reports.total")}
                  </th>
                  <td className={`${TD} ${NUM}`}>{first.totals.pcs}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(first.totals.weightG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(first.totals.lossG)}</td>
                  <td className={TD} />
                </tr>
              </tfoot>
            </table>
          </ReportTableFrame>
          <RegPager shown={rows.length} total={first.total} more={query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
