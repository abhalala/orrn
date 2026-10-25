import { useT } from "@orrn/i18n";
import type { MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Download, Printer } from "lucide-react";
import { useEffect, useState } from "react";

import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { kgFromG, percentOfBp } from "./model";
import { reasonLabel } from "./reason-label";
import type { ReportSearch } from "./search";

const ALL = "__all";

const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 8mm; }
  html[data-press-print] [data-slot="side-nav"],
  html[data-press-print] [data-slot="tab-bar"],
  html[data-press-print] [data-shell-chrome],
  html[data-press-print] [data-slot="app-shell"] > a { display: none !important; }
  html[data-press-print] [data-slot="app-shell"],
  html[data-press-print] [data-slot="app-shell"] > div { display: block !important; min-height: 0 !important; }
  html[data-press-print] main > div { max-width: none !important; padding: 0 !important; }
  html[data-press-print] .press-no-print { display: none !important; }
  html[data-press-print] .press-report-scroll { overflow: visible !important; border: 0 !important; }
  html[data-press-print] .press-report-table { width: 100% !important; min-width: 0 !important; font-size: 7.5px !important; table-layout: fixed; }
  html[data-press-print] .press-report-table th,
  html[data-press-print] .press-report-table td { padding: 2px 3px !important; white-space: normal !important; }
}
`;

const COLUMN_KEYS = [
  ["runNo", "press.report.runNo"],
  ["productionDay", "press.report.productionDay"],
  ["shift", "press.report.shift"],
  ["line", "press.report.line"],
  ["operator", "press.report.operator"],
  ["section", "press.report.section"],
  ["copy", "press.report.copy"],
  ["orders", "press.report.orders"],
  ["cutLengths", "press.report.cutLengths"],
  ["cast", "press.report.cast"],
  ["billets", "press.report.billets"],
  ["startedStopped", "press.report.startedStopped"],
  ["runningMin", "press.report.runningMin"],
  ["downtimeMin", "press.report.downtimeMin"],
  ["good", "press.report.good"],
  ["scrap", "press.report.scrap"],
  ["recovery", "press.report.recovery"],
] as const satisfies readonly (readonly [string, MessageKey])[];

const MONO = new Set(["runNo", "copy", "cast", "startedStopped"]);
const RIGHT = new Set(["runningMin", "recovery"]);

/** `/press/report`: logged runs, 17 columns, landscape; the same columns as the CSV. */
export function ReportScreen({ search, onSearch }: { search: ReportSearch; onSearch: (next: ReportSearch) => void }) {
  const { t, locale } = useT();
  const { data: me } = useMe();
  const today = useQuery({ ...trpc.press.summary.queryOptions({}), meta: INLINE_ERROR_META });
  const lines = useQuery(trpc.press.lines.list.queryOptions({ includeRetired: true }));
  const plans = useQuery(trpc.plans.list.queryOptions({ limit: 100 }));
  const from = search.from ?? search.to ?? today.data?.productionDay;
  const to = search.to ?? search.from ?? today.data?.productionDay;
  const input = from && to ? { from, to, ...(search.shift ? { shiftSeq: search.shift } : {}), ...(search.line ? { pressLineId: search.line } : {}), ...(search.plan ? { planId: search.plan } : {}) } : null;
  const report = useQuery({ ...trpc.press.report.queryOptions(input ?? { from: "2000-01-01", to: "2000-01-01" }), enabled: input !== null, meta: INLINE_ERROR_META });
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.pressPrint = "1";
    return () => {
      delete document.documentElement.dataset.pressPrint;
    };
  }, []);

  const shifts = ((me?.company?.settings as { shifts?: { id: string; name: string }[] } | undefined)?.shifts ?? []) as { id: string; name: string }[];

  const downloadCsv = async () => {
    if (!input) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const out = await trpcClient.press.report.query({ ...input, format: "csv" });
      const blob = new Blob([out.csv ?? ""], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${t("press.report.csvName")}-${input.from}${input.to !== input.from ? `-${input.to}` : ""}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  const data = report.data;
  return (
    <>
      <style>{PRINT_CSS}</style>
      <div className="press-no-print">
        <PageHeader
          title={t("press.report.title")}
          subtitle={t("press.report.subtitle")}
          back={{ to: "/press", label: t("press.title") }}
          actions={
            <>
              <Button variant="secondary" onClick={() => void downloadCsv()} disabled={downloading || !input} aria-busy={downloading}>
                <Download aria-hidden="true" className="size-4" />
                {t("press.report.csv")}
              </Button>
              <Button onClick={() => window.print()}>
                <Printer aria-hidden="true" className="size-4" />
                {t("common.print")}
              </Button>
            </>
          }
        />
      </div>
      {downloadError ? (
        <p role="alert" className="press-no-print m-0 text-[14px] font-medium text-destructive">
          {t("press.report.downloadFailed")}
        </p>
      ) : null}

      <div className="press-no-print grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5" role="group" aria-label={t("common.filter")}>
        <Field label={t("press.report.from")}>
          <TextInput type="date" value={from ?? ""} onChange={(e) => onSearch({ ...search, from: e.currentTarget.value || undefined, to: search.to ?? (e.currentTarget.value || undefined) })} />
        </Field>
        <Field label={t("press.report.to")}>
          <TextInput type="date" value={to ?? ""} onChange={(e) => onSearch({ ...search, to: e.currentTarget.value || undefined })} />
        </Field>
        <Field label={t("press.report.shiftFilter")}>
          <Select
            value={search.shift ? String(search.shift) : ALL}
            onValueChange={(v) => onSearch({ ...search, shift: v === ALL ? undefined : Number(v) })}
            options={[{ value: ALL, label: t("press.report.allShifts") }, ...shifts.map((s, i) => ({ value: String(i + 1), label: s.name }))]}
          />
        </Field>
        <Field label={t("press.report.lineFilter")}>
          <Select
            value={search.line ?? ALL}
            onValueChange={(v) => onSearch({ ...search, line: v === ALL ? undefined : v })}
            options={[{ value: ALL, label: t("press.report.allLines") }, ...(lines.data ?? []).map((l) => ({ value: l.id, label: `${l.code} ${l.name}` }))]}
          />
        </Field>
        <Field label={t("press.report.planFilter")}>
          <Select
            value={search.plan ?? ALL}
            onValueChange={(v) => onSearch({ ...search, plan: v === ALL ? undefined : v })}
            options={[
              { value: ALL, label: t("press.report.allPlans") },
              ...(plans.data?.items ?? []).map((p) => ({ value: p.id, label: t("press.report.planOption", { number: p.number }) })),
            ]}
          />
        </Field>
      </div>

      {showsQueryError(report) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("press.report.loadFailed")} action={<Button variant="secondary" onClick={() => void report.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("press.report.empty")} />
        </div>
      ) : (
        <>
          <p className="m-0 text-[14px] text-muted-foreground">
            {from === to ? from : `${from} - ${to}`} · {t("press.report.runsCount", { count: data.totals.runs })}
          </p>
          <div className="press-report-scroll min-w-0 overflow-x-auto rounded-card border border-border bg-card" tabIndex={0} role="region" aria-label={t("press.report.title")}>
            <table data-testid="press-report-table" className="press-report-table w-max min-w-full border-collapse text-left text-[12px] leading-5">
              <caption className="sr-only">{t("press.report.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  {COLUMN_KEYS.map(([id, key]) => (
                    <th key={id} scope="col" className={`whitespace-nowrap px-2 py-2 font-medium ${RIGHT.has(id) ? "text-right" : ""}`}>
                      {t(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.id} data-run={row.number} className="border-b border-border last:border-0">
                    {COLUMN_KEYS.map(([id]) => {
                      const cell = id === "orders" && row.trial ? t(`press.plan.purpose.${row.purpose}` as MessageKey) : row.cells[id];
                      const content =
                        id === "downtimeMin" && row.downtimeCodes.length > 0
                          ? `${row.downtimeMin} (${row.downtimeReasons.map((c) => reasonLabel(t, "downtime", c.code, c.label, c, locale)).join(", ")})`
                          : cell;
                      return (
                        <td key={id} className={`px-2 py-2 tabular-nums ${id === "cutLengths" ? "min-w-[12rem]" : "whitespace-nowrap"} ${MONO.has(id) ? "font-mono" : ""} ${RIGHT.has(id) ? "text-right" : ""}`}>
                          {content}
                          {id === "runNo" && row.lateEntry ? (
                            <span className="ml-1.5 align-middle">
                              <Chip tone="amber" truncate={false}>
                                {t("press.report.late")}
                              </Chip>
                            </span>
                          ) : null}
                          {id === "runNo" && row.trial ? (
                            <span className="ml-1.5 align-middle">
                              <Chip tone="neutral" truncate={false}>
                                {t("press.report.trial")}
                              </Chip>
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold" data-testid="press-report-totals">
                  <td className="px-2 py-2" colSpan={13}>
                    {t("press.report.totals")}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{data.totals.downtimeMin}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                    {kgFromG(data.totals.goodG)} / {data.totals.pcs}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{kgFromG(data.totals.scrapG)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums">{percentOfBp(data.totals.recoveryBp)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {data.more ? <p className="press-no-print m-0 text-[14px] text-muted-foreground">{t("press.report.more")}</p> : null}
          {data.lateShare.some((g) => g.lateRuns > 0) ? (
            <section className="press-no-print flex flex-col gap-2" aria-labelledby="late-share">
              <h2 id="late-share" className="m-0 text-[15px] font-semibold">
                {t("press.report.lateShareTitle")}
              </h2>
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
                {data.lateShare
                  .filter((g) => g.lateRuns > 0)
                  .map((g) => (
                    <li key={`${g.shiftSeq}-${g.operatorId}`}>
                      <span className="font-medium">
                        {g.shiftName ?? g.shiftSeq} · {g.operatorName ?? t("press.report.noOperator")}
                      </span>{" "}
                      {t("press.report.lateShareRow", { late: g.lateRuns, runs: g.runs, pct: percentOfBp(g.shareBp) })}
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
