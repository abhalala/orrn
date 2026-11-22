import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { collectPages, rejectionReason, rejectionsCsv } from "./reg-model";
import type { RejectionsSearch } from "./reg-search";
import { Dash, RegEmpty, RegLoadFailed, RegLoading, RegPager, RegRangeFields, RegStat, useRegRange } from "./reg-shared";
import { NUM, ReportActions, ReportPrintContext, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

const PAGE = 100;

/** `/reports/rejections` (#30): press QC rejects of logged runs and pack rejects, paged, totals over the whole filter. */
export function RejectionsReport({ search, onSearch }: { search: RejectionsSearch; onSearch: (next: RejectionsSearch) => void }) {
  return (
    <ReportsGate>
      <Body search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function Body({ search, onSearch }: { search: RejectionsSearch; onSearch: (next: RejectionsSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const range = useRegRange(search);
  const base = range
    ? {
        ...range,
        ...(search.source ? { source: search.source } : {}),
        ...(search.section ? { sectionId: search.section } : {}),
        ...(search.line ? { pressLineId: search.line } : {}),
        ...(search.shift ? { shiftId: search.shift } : {}),
        ...(search.reason ? { reason: search.reason } : {}),
      }
    : null;
  const query = useInfiniteQuery({
    queryKey: [...trpc.reports.rejections.queryKey(base ?? { from: "2000-01-01", to: "2000-01-01" }), "pages"],
    queryFn: ({ pageParam }) => trpcClient.reports.rejections.query({ ...base!, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: base !== null,
    meta: INLINE_ERROR_META,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.rows);
  const kg = (g: number) => kgGrouped3(fmt, g);
  // The URL carries the reason key (an id for a press reject); the chip says its words.
  const filterLabel = first?.byReason[0] ? rejectionReason(first.byReason[0]) || t("reg.reports.rejections.noReason") : "";
  const unit = massUnit(fmt);

  const csv = async () => {
    if (!base) return null;
    const all = await collectPages((offset) => trpcClient.reports.rejections.query({ ...base, limit: 500, offset }));
    const totals = first?.totals ?? (await trpcClient.reports.rejections.query({ ...base, limit: 1, offset: 0 })).totals;
    return { name: csvFileName(t("reg.reports.rejections.csvName"), base.from, base.to), text: rejectionsCsv(all, totals, t) };
  };

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.rejections.title")}
        subtitle={t("reg.reports.rejections.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={csv} />
          </div>
        }
      />
      <ReportPrintContext parts={[range ? `${range.from} - ${range.to}` : null, search.source ? t(search.source === "press" ? "reg.reports.rejections.sourcePress" : "reg.reports.rejections.sourcePack") : null, search.reason && filterLabel ? t("reg.reports.rejections.filterReason", { reason: filterLabel }) : null]} />
      <div className="report-no-print grid grid-cols-1 items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label={t("common.filter")}>
        <RegRangeFields search={search} range={range} onSearch={onSearch} />
        <SegmentedControl
          label={t("reg.reports.rejections.source")}
          value={search.source ?? "all"}
          onChange={(v) => onSearch({ ...search, source: v === "all" ? undefined : v })}
          options={[
            { value: "all", label: t("reg.reports.rejections.all") },
            { value: "press", label: t("reg.reports.rejections.sourcePress") },
            { value: "pack", label: t("reg.reports.rejections.sourcePack") },
          ]}
        />
      </div>
      {search.reason ? (
        <div className="report-no-print flex flex-wrap items-center gap-2">
          <Chip tone="neutral">{t("reg.reports.rejections.filterReason", { reason: filterLabel })}</Chip>
          <button type="button" className="min-h-11 text-[14px] font-medium text-primary underline" onClick={() => onSearch({ ...search, reason: undefined })}>
            {t("reg.reports.rejections.clearReason")}
          </button>
        </div>
      ) : null}

      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !first ? (
        <RegLoading />
      ) : first.totals.entries === 0 ? (
        <RegEmpty title={t("reg.reports.rejections.empty")} />
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3" data-testid="rejections-totals">
            <RegStat label={t("reg.reports.col.entries")}>{first.totals.entries}</RegStat>
            <RegStat label={t("reg.reports.col.pieces")}>{first.totals.pcs}</RegStat>
            <RegStat label={t("reg.reports.col.weight", { massUnit: unit })}>{kg(first.totals.kgG)}</RegStat>
          </div>
          <ReportTableFrame label={t("reg.reports.rejections.title")}>
            <table data-testid="rejections-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reg.reports.rejections.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {(["day", "source", "run", "section", "copy", "press", "shift", "reason"] as const).map((k) => (
                    <th key={k} scope="col" className={TH}>
                      {t(`reg.reports.col.${k}`)}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.pieces")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.weight", { massUnit: unit })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-b border-border last:border-0">
                    <td className={`${TD} whitespace-nowrap`}>{r.day ?? <Dash />}</td>
                    <td className={TD}>{t(r.source === "press" ? "reg.reports.rejections.sourcePress" : "reg.reports.rejections.sourcePack")}</td>
                    <td className={TD}>{r.runNumber ?? <Dash />}</td>
                    <td className={TD}>{r.sectionCode}</td>
                    <td className={TD}>{r.copyCode ?? <Dash />}</td>
                    <td className={TD}>{r.pressCode ?? <Dash />}</td>
                    <td className={TD}>{r.shiftName ?? <Dash />}</td>
                    <td className={TD}>{rejectionReason(r) || <Dash />}</td>
                    <td className={`${TD} ${NUM}`}>{r.pcs}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.kgG)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <th scope="row" colSpan={8} className={TD}>
                    {t("reports.total")}
                  </th>
                  <td className={`${TD} ${NUM}`}>{first.totals.pcs}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(first.totals.kgG)}</td>
                </tr>
              </tfoot>
            </table>
          </ReportTableFrame>
          <RegPager shown={rows.length} total={first.total} more={query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />

          {first.byReason.length > 0 ? (
            <section aria-labelledby="by-reason-title" className="flex min-w-0 flex-col gap-2">
              <h2 id="by-reason-title" className="m-0 text-[17px] font-semibold">
                {t("reg.reports.rejections.byReasonTitle")}
              </h2>
              <ReportTableFrame label={t("reg.reports.rejections.byReasonTitle")}>
                <table data-testid="rejections-by-reason" className="report-table w-full border-collapse text-left text-[13px] leading-5">
                  <caption className="sr-only">{t("reg.reports.rejections.byReasonTitle")}</caption>
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className={TH}>
                        {t("reg.reports.col.reason")}
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        {t("reg.reports.col.entries")}
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        {t("reg.reports.col.pieces")}
                      </th>
                      <th scope="col" className={`${TH} text-right`}>
                        {t("reg.reports.col.weight", { massUnit: unit })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {first.byReason.map((r) => {
                      const label = rejectionReason(r) || t("reg.reports.rejections.noReason");
                      return (
                        <tr key={`${r.source}-${r.reasonKey}`} className="border-b border-border last:border-0">
                          <th scope="row" className={`${TD} font-medium`}>
                            {r.reasonKey ? (
                              <button type="button" className="min-h-11 text-left underline-offset-2 hover:underline" aria-label={t("reg.reports.rejections.pickReason", { reason: label })} onClick={() => onSearch({ ...search, reason: r.reasonKey })}>
                                {label}
                              </button>
                            ) : (
                              label
                            )}
                          </th>
                          <td className={`${TD} ${NUM}`}>{r.entries}</td>
                          <td className={`${TD} ${NUM}`}>{r.pcs}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap`}>{kg(r.kgG)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ReportTableFrame>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
