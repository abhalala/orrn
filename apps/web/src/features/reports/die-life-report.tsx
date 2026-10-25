import { useT } from "@orrn/i18n";
import type { MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQueries } from "@tanstack/react-query";
import { useState } from "react";

import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { csvFileName, dieLifeCsv, kgText, lifeChip, lifeTone, type DieLifeItem } from "./model";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, ReportToggle as Toggle, TD, TH } from "./report-chrome";
import type { DieLifeSearch } from "./search";

const PAGE = 100;

/** `/reports/die-life`: copies by share of planned life used (`analytics.dieLife`), highest first. */
export function DieLifeReport({ search, onSearch }: { search: DieLifeSearch; onSearch: (next: DieLifeSearch) => void }) {
  return (
    <ReportsGate>
      <DieLifeBody search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function DieLifeBody({ search, onSearch }: { search: DieLifeSearch; onSearch: (next: DieLifeSearch) => void }) {
  const { t } = useT();
  const [pages, setPages] = useState(1);
  const filter = { withLife: !search.all, includeRetired: Boolean(search.retired) };
  const queries = useQueries({
    queries: Array.from({ length: pages }, (_, i) => ({
      ...trpc.analytics.dieLife.queryOptions({ ...filter, limit: PAGE, offset: i * PAGE }),
      meta: INLINE_ERROR_META,
    })),
  });
  const first = queries[0]!;
  const items: DieLifeItem[] = queries.flatMap((q) => q.data?.items ?? []);
  const last = queries[queries.length - 1];
  const statusLabel = (s: string) => t(`dieRoom.status.${s}` as MessageKey);
  const toggle = (patch: Partial<DieLifeSearch>) => {
    setPages(1);
    const next = { ...search, ...patch };
    onSearch({ ...(next.all ? { all: true } : {}), ...(next.retired ? { retired: true } : {}) });
  };

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reports.dieLife.title")}
        subtitle={t("reports.dieLife.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (items.length ? { name: csvFileName(t("reports.dieLife.csvName")), text: dieLifeCsv(items, t, statusLabel) } : null)} />
          </div>
        }
      />
      <div className="report-no-print flex flex-wrap gap-x-6 gap-y-3" role="group" aria-label={t("common.filter")}>
        <Toggle id="life-only" checked={!search.all} onChange={(v) => toggle({ all: !v })} label={t("reports.dieLife.withLifeOnly")} />
        <Toggle id="life-retired" checked={Boolean(search.retired)} onChange={(v) => toggle({ retired: v })} label={t("reports.dieLife.includeRetired")} />
      </div>

      {first.isError && !first.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={() => void first.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !first.data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : items.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("reports.dieLife.empty")} />
        </div>
      ) : (
        <>
          <p className="m-0 text-[14px] text-muted-foreground" data-testid="die-life-counts">
            {t("reports.dieLife.counts", first.data.counts)}
          </p>
          <ReportTableFrame label={t("reports.dieLife.title")}>
            <table data-testid="die-life-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reports.dieLife.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className={TH}>{t("reports.dieLife.copy")}</th>
                  <th scope="col" className={TH}>{t("reports.dieLife.section")}</th>
                  <th scope="col" className={TH}>{t("reports.dieLife.status")}</th>
                  <th scope="col" className={TH}>{t("reports.dieLife.used")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.dieLife.pressed")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.dieLife.life")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.dieLife.left")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.dieLife.runs")}</th>
                  <th scope="col" className={TH}>{t("reports.dieLife.lastRun")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.dieInstanceId} className="border-b border-border last:border-0" data-copy={i.code} data-state={i.state}>
                    <th scope="row" className={`${TD} whitespace-nowrap font-mono font-semibold`}>
                      <UiLink to={`/dies/copies/${i.dieInstanceId}?tab=runs`} className="text-foreground underline underline-offset-4">
                        {i.code}
                      </UiLink>
                    </th>
                    <td className={`${TD} min-w-[8rem]`}>{i.sectionName ? `${i.sectionCode} ${i.sectionName}` : i.sectionCode}</td>
                    <td className={`${TD} whitespace-nowrap`}>{statusLabel(i.status)}</td>
                    <td className={`${TD} whitespace-nowrap`}>
                      <Chip tone={lifeTone(i.state)} truncate={false}>
                        {lifeChip(i, t)}
                      </Chip>
                    </td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(i.producedG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{i.lifeG == null ? "—" : kgText(i.lifeG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{i.remainingG == null ? "—" : kgText(i.remainingG)}</td>
                    <td className={`${TD} ${NUM}`}>{i.runs}</td>
                    <td className={`${TD} whitespace-nowrap`}>{i.lastRunDay ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ReportTableFrame>
          {last?.data?.nextOffset != null ? (
            <div className="report-no-print">
              <Button variant="secondary" onClick={() => setPages((n) => n + 1)} disabled={last.isFetching}>
                {t("reports.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}
