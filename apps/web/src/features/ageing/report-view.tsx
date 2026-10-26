import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@orrn/server/routers/index";

import { useCompanyTimeZone } from "@/features/dispatch/hooks";
import { companyToday } from "@/features/masters/masters-ui";
import { ReportActions, ReportPrintStyle, ReportsGate, ReportTableFrame, NUM, TD, TH } from "@/features/reports/report-chrome";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useShifts } from "./hooks";
import { STATUS_FILTERS, x10Text } from "./model";
import { FieldSelect as NativeSelect } from "./ui";
import { dayOf, groupRows, joinCsvPages, type GroupKey } from "./report-model";
import type { AgeingReportSearch, HistoryStatus } from "./search";

type ReportRow = inferRouterOutputs<AppRouter>["reports"]["ageing"]["rows"][number];
const PAGE = 100;

/**
 * `/reports/ageing` (FP-AG-10): one row per trolley line whose batch went in between two company
 * days, with the press run, order, cast, pieces (loaded, taken by pack, on bundles, remaining) and
 * the hardness verdict. The server pages it; the CSV button walks every page. Totals by day or oven
 * are subtotals of the rows on the page.
 */
export function AgeingReport({ search, onSearch }: { search: AgeingReportSearch; onSearch: (next: AgeingReportSearch) => void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const tz = useCompanyTimeZone();
  const queryClient = useQueryClient();
  const { settings } = useShifts();
  const today = settings.data?.productionDay?.day ?? companyToday(tz);
  const from = search.from ?? search.to ?? today;
  const to = search.to ?? search.from ?? today;
  const offset = search.offset ?? 0;
  const filters = { from, to, ...(search.oven ? { ovenId: search.oven } : {}), ...(search.shift ? { shiftId: search.shift } : {}), ...(search.status ? { status: search.status } : {}) };
  const ovens = useQuery({ ...trpc.ageing.ovens.list.queryOptions({ includeInactive: true }), meta: INLINE_ERROR_META });
  const query = useQuery({
    ...trpc.reports.ageing.queryOptions({ ...filters, format: "json", limit: PAGE, offset }),
    enabled: from <= to,
    meta: INLINE_ERROR_META,
  });
  const rows = query.data?.rows ?? [];
  const wide = useMediaQuery(breakpoints.desktop);
  const group: GroupKey | null = search.group === "day" || search.group === "oven" ? search.group : null;
  const set = (patch: Partial<AgeingReportSearch>) => onSearch({ ...search, offset: undefined, ...patch });

  const csv = async () => {
    const pages: string[] = [];
    for (let o = 0; o < 20 * PAGE; o += PAGE) {
      const res = await queryClient.fetchQuery(trpc.reports.ageing.queryOptions({ ...filters, format: "csv", limit: PAGE, offset: o }));
      if (res.csv) pages.push(res.csv);
      if (o + PAGE >= res.total) break;
    }
    return { name: `ageing-${from}-${to}.csv`, text: joinCsvPages(pages) };
  };

  const columns: ResponsiveListColumn<ReportRow>[] = [
    { key: "batch", header: t("ageing.field.number"), cell: (r) => <span className="font-mono font-semibold whitespace-nowrap">{r.batchNumber}</span> },
    { key: "day", header: t("ageing.field.day"), cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{dayOf(r.inAt, tz)}</span> },
    { key: "oven", header: t("ageing.field.oven"), cell: (r) => <span className="font-mono">{r.ovenCode ?? "-"}</span> },
    { key: "trolley", header: t("ageing.field.trolley"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.trolleyCode}</span> },
    { key: "shift", header: t("ageing.field.shift"), hideOnPhone: true, cell: (r) => r.shiftName ?? "-" },
    { key: "in", header: t("ageing.field.inAt"), hideOnPhone: true, cell: (r) => (r.inAt ? <span className="whitespace-nowrap tabular-nums">{when(r.inAt)}</span> : "-") },
    { key: "out", header: t("ageing.field.outAt"), hideOnPhone: true, cell: (r) => (r.outAt ? <span className="whitespace-nowrap tabular-nums">{when(r.outAt)}</span> : "-") },
    {
      key: "soak",
      header: t("ageing.report.soak"),
      hideOnPhone: true,
      align: "end",
      cell: (r) => <span className="font-mono tabular-nums">{r.soakMin ?? "-"}{r.recipeSoakMin ? ` / ${r.recipeSoakMin}` : ""}</span>,
    },
    { key: "temp", header: t("ageing.report.temps"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{x10Text(r.setTempCX10)} · {x10Text(r.actualMinX10)}-{x10Text(r.actualMaxX10)}</span> },
    { key: "run", header: t("ageing.field.pressRun"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.pressRunNumber ?? "-"}</span> },
    { key: "order", header: t("ageing.field.salesOrder"), hideOnPhone: true, cell: (r) => [r.salesOrderNumber, r.customerName, r.customerPo].filter(Boolean).join(" · ") || "-" },
    { key: "cast", header: t("ageing.field.cast"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.castCode ?? "-"}</span> },
    { key: "section", header: t("ageing.field.section"), cell: (r) => [r.dieInstanceCode, r.sectionLabel].filter(Boolean).join(" · ") },
    { key: "len", header: t("ageing.field.cutLength"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.lengthMm}</span> },
    { key: "loaded", header: t("ageing.field.loaded"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.loadedPcs}</span> },
    { key: "taken", header: t("ageing.report.taken"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.takenByPackPcs}</span> },
    { key: "bundles", header: t("ageing.report.onBundles"), hideOnPhone: true, align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.onBundlesPcs}</span> },
    { key: "left", header: t("ageing.field.remaining"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{r.remainingPcs}</span> },
    {
      key: "hard",
      header: t("ageing.field.hardness"),
      phoneWide: true,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-2">
          {r.held ? <Chip tone="red" truncate={false}>{t("ageing.rowStatus.held")}</Chip> : null}
          {r.hardnessMethod ? <span className="font-mono tabular-nums">{x10Text(r.medianX10)} {t(`ageing.method.${r.hardnessMethod}`)}</span> : <span className="text-muted-foreground">-</span>}
          {r.pass === null ? null : <Chip tone={r.pass ? "green" : "red"} truncate={false}>{r.pass ? t("ageing.readings.pass") : t("ageing.readings.fail")}</Chip>}
        </span>
      ),
    },
  ];
  const groups = group ? groupRows(rows, group, tz) : [];

  return (
    <ReportsGate>
      <ReportPrintStyle />
      <PageHeader title={t("ageing.report.title")} subtitle={t("ageing.report.subtitle")} back={{ to: "/reports", label: t("reports.title") }} actions={<div className="report-no-print flex flex-wrap gap-2"><ReportActions csv={csv} /></div>} />
      <div className="report-no-print grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" data-testid="ageing-report-filters">
        <Field label={t("ageing.history.from")}>
          <TextInput type="date" value={from} onChange={(e) => set({ from: e.currentTarget.value || undefined })} data-testid="report-from" />
        </Field>
        <Field label={t("ageing.history.to")}>
          <TextInput type="date" value={to} onChange={(e) => set({ to: e.currentTarget.value || undefined })} data-testid="report-to" />
        </Field>
        <Field label={t("ageing.field.oven")}>
          <NativeSelect value={search.oven ?? ""} onChange={(e) => set({ oven: e.currentTarget.value || undefined })} data-testid="report-oven">
            <option value="">{t("ageing.history.anyOven")}</option>
            {(ovens.data?.items ?? []).map((o) => (
              <option key={o.id} value={o.id}>{o.code}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("ageing.field.shift")}>
          <NativeSelect value={search.shift ?? ""} onChange={(e) => set({ shift: e.currentTarget.value || undefined })}>
            <option value="">{t("ageing.report.anyShift")}</option>
            {(settings.data?.shifts ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("ageing.field.verdict")}>
          <NativeSelect value={search.status ?? ""} onChange={(e) => set({ status: (e.currentTarget.value || undefined) as HistoryStatus | undefined })}>
            <option value="">{t("ageing.history.anyStatus")}</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>{t(`ageing.status.${s}`)}</option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="report-no-print">
        <SegmentedControl<"none" | GroupKey>
          label={t("ageing.report.groupBy")}
          value={group ?? "none"}
          onChange={(v) => onSearch({ ...search, group: v === "none" ? undefined : v })}
          options={[
            { value: "none", label: t("ageing.report.group.none") },
            { value: "day", label: t("ageing.report.group.day") },
            { value: "oven", label: t("ageing.report.group.oven") },
          ]}
        />
      </div>
      {from > to ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-destructive">{t("ageing.report.badRange")}</p>
      ) : showsQueryError(query) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : (
        <>
          {groups.length > 0 ? (
            <ReportTableFrame label={t("ageing.report.groupBy")}>
              <table className="report-table w-full border-collapse text-left text-[13px] leading-5" data-testid="ageing-groups">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th scope="col" className={TH}>{t(`ageing.report.group.${group ?? "none"}`)}</th>
                    <th scope="col" className={`${TH} text-right`}>{t("ageing.report.batches")}</th>
                    <th scope="col" className={`${TH} text-right`}>{t("ageing.field.loaded")}</th>
                    <th scope="col" className={`${TH} text-right`}>{t("ageing.report.taken")}</th>
                    <th scope="col" className={`${TH} text-right`}>{t("ageing.field.remaining")}</th>
                    <th scope="col" className={`${TH} text-right`}>{t("ageing.report.heldLines")}</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.key} className="border-b border-border last:border-0" data-group={g.key}>
                      <th scope="row" className={`${TD} font-medium`}>{g.key}</th>
                      <td className={`${TD} ${NUM}`}>{g.batches}</td>
                      <td className={`${TD} ${NUM}`}>{g.loadedPcs}</td>
                      <td className={`${TD} ${NUM}`}>{g.takenByPackPcs}</td>
                      <td className={`${TD} ${NUM}`}>{g.remainingPcs}</td>
                      <td className={`${TD} ${NUM}`}>{g.heldLines}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableFrame>
          ) : null}
          {wide && rows.length > 0 ? (
            // Wide report: a focusable, scrollable frame (the list kit's own scroller is not keyboard reachable).
            <ReportTableFrame label={t("ageing.report.title")}>
              <table className="report-table w-full border-collapse text-left text-[13px] leading-5" data-testid="ageing-report-table">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    {columns.map((c) => (
                      <th key={c.key} scope="col" className={`${TH} ${c.align === "end" ? "text-right" : ""}`}>
                        {c.header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      {columns.map((c) => (
                        <td key={c.key} className={`${TD} ${c.align === "end" ? "text-right" : ""}`}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </ReportTableFrame>
          ) : (
            <ResponsiveList
              rows={rows}
              columns={columns}
              loading={query.isLoading}
              total={query.data?.total}
              page={{ offset, limit: PAGE, onChange: (o) => onSearch({ ...search, offset: o || undefined }) }}
              label={t("ageing.report.title")}
              empty={<EmptyState title={t("ageing.empty.noBatches")} />}
            />
          )}
          {wide && query.data && query.data.total > PAGE ? (
            <p className="report-no-print m-0 flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground" data-testid="report-pager">
              {t("ageing.report.shown", { from: offset + 1, to: Math.min(offset + PAGE, query.data.total), total: query.data.total })}
              <Button variant="secondary" size="sm" disabled={offset === 0} onClick={() => onSearch({ ...search, offset: Math.max(0, offset - PAGE) || undefined })}>
                {t("ageing.report.prev")}
              </Button>
              <Button variant="secondary" size="sm" disabled={offset + PAGE >= query.data.total} onClick={() => onSearch({ ...search, offset: offset + PAGE })}>
                {t("ageing.report.next")}
              </Button>
            </p>
          ) : null}
          <p className="m-0 text-[13px] text-muted-foreground">
            <UiLink to={`/ageing/history?from=${from}&to=${to}`}>{t("ageing.report.toHistory")}</UiLink>
          </p>
        </>
      )}
    </ReportsGate>
  );
}
