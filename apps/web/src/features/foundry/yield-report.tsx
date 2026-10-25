import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { useQuery } from "@tanstack/react-query";

import { kgFromG } from "@/features/press/model";
import { csvFileName, toCsv } from "@/features/reports/model";
import { NUM, ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, TD, TH } from "@/features/reports/report-chrome";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { addDays, todayIn } from "./melt-times";
import { bpText } from "./model";
import type { YieldGroup, YieldSearch } from "./search";
import { ErrorLine, LoadFailed, useTimeZone } from "./ui";

const GROUPS: readonly YieldGroup[] = ["day", "alloy", "furnace"];

/** LDO tenths of an inch per tonne as "1.4 in/t". */
const ldoText = (tenth: number | null) => (tenth === null ? "-" : (tenth / 10).toFixed(1));

/**
 * `/reports/foundry-yield` (FP-FD-19): locked melts by production day, alloy or furnace for up to 92
 * days. Kg in, logs, dross, iron, burn %, yield % and LDO inches per tonne of metal charged, as the
 * server worked them out. A draft cannot improve the month.
 */
export function FoundryYieldReport({ search, onSearch }: { search: YieldSearch; onSearch(next: YieldSearch): void }) {
  const { t } = useT();
  const tz = useTimeZone();
  const today = todayIn(tz);
  const to = search.to ?? today;
  const from = search.from ?? addDays(to, -29);
  const group: YieldGroup = search.group ?? "day";
  const query = useQuery({ ...trpc.analytics.foundryYield.queryOptions({ from, to, groupBy: group }), meta: INLINE_ERROR_META });
  const d = query.data;
  const label = (key: string) => (group === "alloy" || group === "furnace" ? key : key);
  const csv = () =>
    d
      ? {
          name: csvFileName(t("foundry.yield.csvName"), from, to),
          text: toCsv(
            [t(`foundry.yield.group.${group}`), t("foundry.yield.melts"), t("foundry.yield.in"), t("foundry.yield.logs"), t("foundry.yield.dross"), t("foundry.yield.fe"), t("foundry.yield.burn"), t("foundry.yield.yield"), t("foundry.yield.ldo")],
            d.rows.map((r) => [r.key, r.melts, (r.inputG / 1000).toFixed(3), (r.logsG / 1000).toFixed(3), (r.drossG / 1000).toFixed(3), (r.feG / 1000).toFixed(3), r.burnBp === null ? "" : bpText(r.burnBp), r.yieldBp === null ? "" : bpText(r.yieldBp), r.ldoPerTonneTenthIn === null ? "" : ldoText(r.ldoPerTonneTenthIn)]),
          ),
        }
      : null;
  return (
    <ReportsGate>
      <ReportPrintStyle />
      <PageHeader title={t("foundry.yield.title")} subtitle={t("foundry.yield.subtitle")} back={{ to: "/reports", label: t("reports.title") }} />
      <div className="report-no-print flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Field label={t("reports.from")}>
            <TextInput type="date" value={from} max={to} onChange={(e) => onSearch({ ...search, from: e.currentTarget.value || undefined })} data-testid="yield-from" />
          </Field>
        </div>
        <div className="w-44">
          <Field label={t("reports.to")}>
            <TextInput type="date" value={to} min={from} onChange={(e) => onSearch({ ...search, to: e.currentTarget.value || undefined })} data-testid="yield-to" />
          </Field>
        </div>
        <SegmentedControl
          label={t("foundry.yield.groupBy")}
          value={group}
          onChange={(v) => onSearch({ ...search, group: v === "day" ? undefined : (v as "alloy" | "furnace") })}
          options={GROUPS.map((g) => ({ value: g, label: t(`foundry.yield.group.${g}`) }))}
        />
        <ReportActions csv={csv} />
      </div>
      <p className="report-print-context m-0 hidden">{`${t("foundry.yield.title")} · ${from} - ${to}`}</p>
      {showsQueryError(query) ? (
        <>
          <LoadFailed title={t("reports.loadFailed")} onRetry={() => void query.refetch()} />
          <ErrorLine error={query.error} />
        </>
      ) : !d ? (
        <Skeleton className="h-40 rounded-card" />
      ) : d.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("foundry.yield.empty")} />
        </div>
      ) : (
        <ReportTableFrame label={t("foundry.yield.title")}>
          <table data-testid="yield-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
            <caption className="sr-only">{t("foundry.yield.title")}</caption>
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th scope="col" className={TH}>{t(`foundry.yield.group.${group}`)}</th>
                {(["melts", "in", "logs", "dross", "fe", "burn", "yield", "ldo"] as const).map((k) => (
                  <th key={k} scope="col" className={`${TH} text-right`}>{t(`foundry.yield.${k}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r) => (
                <tr key={r.key} className="border-b border-border last:border-0" data-key={r.key}>
                  <th scope="row" className={`${TD} font-medium`}>{label(r.key)}</th>
                  <td className={`${TD} ${NUM}`}>{r.melts}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(r.inputG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(r.logsG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(r.drossG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(r.feG)}</td>
                  <td className={`${TD} ${NUM}`}>{r.burnBp === null ? "-" : bpText(r.burnBp)}</td>
                  <td className={`${TD} ${NUM} font-semibold`}>{r.yieldBp === null ? "-" : bpText(r.yieldBp)}</td>
                  <td className={`${TD} ${NUM}`}>{ldoText(r.ldoPerTonneTenthIn)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold" data-testid="yield-totals">
                <th scope="row" className={TD}>{t("reports.total")}</th>
                <td className={`${TD} ${NUM}`}>{d.total.melts}</td>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(d.total.inputG)}</td>
                <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgFromG(d.total.logsG)}</td>
                <td className={TD} />
                <td className={TD} />
                <td className={`${TD} ${NUM}`}>{d.total.inputG > 0 ? bpText(Math.round((d.total.burnG * 10_000) / d.total.inputG)) : "-"}</td>
                <td className={`${TD} ${NUM}`}>{d.total.yieldBp === null ? "-" : bpText(d.total.yieldBp)}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </table>
        </ReportTableFrame>
      )}
      {d && d.total.tailAdjustG !== 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground" data-testid="yield-tail-adjust">
          {t("foundry.yield.tailAdjust", { kg: `${d.total.tailAdjustG < 0 ? "-" : "+"}${kgFromG(Math.abs(d.total.tailAdjustG))}`, pct: d.total.netYieldBp === null ? "-" : bpText(d.total.netYieldBp) })}
        </p>
      ) : null}
      <p className="m-0 text-[13px] text-muted-foreground">{t("foundry.yield.note")}</p>
    </ReportsGate>
  );
}
