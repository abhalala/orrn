import { useT } from "@orrn/i18n";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useInfiniteQuery } from "@tanstack/react-query";

import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped3, massUnit } from "@/shared/lib/fmt-text";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { csvFileName } from "./model";
import { collectPages, WIP_STAGE_KEYS, wipCsv, type WipRow, type WipStageKey } from "./reg-model";
import type { WipSearch } from "./reg-search";
import { Dash, RegEmpty, RegLoadFailed, RegLoading, RegPager, RegStat } from "./reg-shared";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "./report-chrome";

const PAGE = 50;

/** Fill of each stage in the bar; the kg are in the table too, so colour is never the only signal. */
const STAGE_FILL: Record<WipStageKey, string> = {
  notPlanned: "bg-muted",
  planned: "bg-primary/20",
  onPress: "bg-primary/40",
  ageing: "bg-primary/60",
  unpacked: "bg-primary/80",
  packed: "bg-primary",
  dispatched: "bg-foreground",
};

/** `/reports/wip` (#32): where every kg of each open order line sits. */
export function WipReport({ search }: { search: WipSearch }) {
  return (
    <ReportsGate>
      <Body search={search} />
    </ReportsGate>
  );
}

function StageBar({ row, label }: { row: WipRow; label: string }) {
  // Widths are the grams themselves as flex-grow; the browser divides the bar, the client computes nothing.
  return (
    <div role="img" aria-label={label} className="flex h-3 min-w-[8rem] overflow-hidden rounded-full border border-border">
      {WIP_STAGE_KEYS.filter((k) => row.wip[k] > 0).map((k) => (
        <span key={k} className={STAGE_FILL[k]} style={{ flexGrow: row.wip[k], flexBasis: 0 }} />
      ))}
    </div>
  );
}

function Body({ search }: { search: WipSearch }) {
  const { t } = useT();
  const fmt = useFmt();
  const base = search.party ? { customerId: search.party } : {};
  const query = useInfiniteQuery({
    queryKey: [...trpc.reports.wip.queryKey(base), "pages"],
    queryFn: ({ pageParam }) => trpcClient.reports.wip.query({ ...base, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    meta: INLINE_ERROR_META,
  });
  const pages = query.data?.pages ?? [];
  const first = pages[0];
  const rows = pages.flatMap((p) => p.rows);
  const kg = (g: number) => kgGrouped3(fmt, g);
  const unit = massUnit(fmt);

  const csv = async () => {
    const all = await collectPages((offset) => trpcClient.reports.wip.query({ ...base, limit: 200, offset }));
    return { name: csvFileName(t("reg.reports.wip.csvName")), text: wipCsv(all, t) };
  };

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reg.reports.wip.title")}
        subtitle={t("reg.reports.wip.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={csv} />
          </div>
        }
      />
      <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[13px]" aria-label={t("reg.reports.wip.bar")}>
        {WIP_STAGE_KEYS.map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`size-3 rounded-full border border-border ${STAGE_FILL[k]}`} />
            {t(`reg.stage.${k}`)}
          </li>
        ))}
      </ul>

      {showsQueryError(query) ? (
        <RegLoadFailed onRetry={() => void query.refetch()} />
      ) : !first ? (
        <RegLoading />
      ) : first.totals.lines === 0 ? (
        <RegEmpty title={t("reg.reports.wip.empty")} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="wip-totals">
            <RegStat label={t("reg.reports.col.lines")}>{first.totals.lines}</RegStat>
            <RegStat label={t("reg.reports.col.ordered", { massUnit: unit })}>{kg(first.totals.orderedG)}</RegStat>
            <RegStat label={t("reg.reports.col.dispatched", { massUnit: unit })}>{kg(first.totals.dispatchedG)}</RegStat>
            <RegStat label={t("reg.reports.col.baki", { massUnit: unit })}>{kg(first.totals.bakiG)}</RegStat>
          </div>
          <ReportTableFrame label={t("reg.reports.wip.title")}>
            <table data-testid="wip-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reg.reports.wip.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {(["order", "po", "party", "line", "section"] as const).map((k) => (
                    <th key={k} scope="col" className={TH}>
                      {t(`reg.reports.col.${k}`)}
                    </th>
                  ))}
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.cutLength")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    {t("reg.reports.col.baki", { massUnit: unit })}
                  </th>
                  <th scope="col" className={TH}>
                    {t("reg.reports.col.stages")}
                  </th>
                  {WIP_STAGE_KEYS.map((k) => (
                    <th key={k} scope="col" className={`${TH} text-right`}>
                      {t(`reg.stage.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.lineId} className="border-b border-border last:border-0">
                    <td className={`${TD} font-medium`}>{r.orderNumber}</td>
                    <td className={TD}>{r.poNumber ?? <Dash />}</td>
                    <td className={TD}>{r.customerName}</td>
                    <td className={TD}>{r.lineNo}</td>
                    <td className={TD}>{r.sectionCode}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{fmt.q("bundle.length", r.cutLengthMm)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap font-semibold`}>{kg(r.bakiG)}</td>
                    <td className={`${TD} min-w-[9rem]`}>
                      <StageBar row={r} label={t("reg.reports.wip.barLabel", { order: r.orderNumber, line: r.lineNo })} />
                    </td>
                    {WIP_STAGE_KEYS.map((k) => (
                      <td key={k} className={`${TD} ${NUM} whitespace-nowrap`}>
                        {r.wip[k] === 0 ? <Dash /> : kg(r.wip[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableFrame>
          <RegPager shown={rows.length} total={first.totals.lines} more={query.hasNextPage} loading={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
        </>
      )}
    </>
  );
}
