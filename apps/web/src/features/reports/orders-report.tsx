import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { lazy, Suspense } from "react";

import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { csvFileName, kgText, monthNames, ordersCsv, ordersFilterInput, ordersRowName, rupeeText } from "./model";
import { NUM, ReportActions, ReportPrintContext, ReportPrintStyle, ReportsGate, ReportTableFrame, ReportToggle, TD, TH } from "./report-chrome";
import type { OrdersReportSearch, OrdersShow } from "./search";

const OrderMonthsChart = lazy(() => import("./report-charts").then((m) => ({ default: m.OrderMonthsChart })));

/**
 * `/reports/orders`: the order book (FP-OP-20) summed by party or by order month with the order
 * book's own filters (`analytics.orders`). Rupee columns appear only when the server says the
 * caller may see rates (`order.price` + `priceOnSalesOrder`) and the person asks for them.
 */
export function OrdersReport({ search, onSearch }: { search: OrdersReportSearch; onSearch: (next: OrdersReportSearch) => void }) {
  return (
    <ReportsGate>
      <OrdersBody search={search} onSearch={onSearch} />
    </ReportsGate>
  );
}

function OrdersBody({ search, onSearch }: { search: OrdersReportSearch; onSearch: (next: OrdersReportSearch) => void }) {
  const { t } = useT();
  const group = search.group ?? "customer";
  // Open orders unless the person picks another status: the order book's own default, so the foot
  // below is the order book strip for these filters.
  const filters = ordersFilterInput(search);
  const show = search.show ?? "open";
  // Ask for rupees only once a plain answer has said this person may see them.
  const plain = useQuery({ ...trpc.analytics.orders.queryOptions(filters), placeholderData: keepPreviousData, meta: INLINE_ERROR_META });
  const wantRates = Boolean(search.rates && plain.data?.ratesAllowed);
  const priced = useQuery({
    ...trpc.analytics.orders.queryOptions({ ...filters, withRates: true }),
    enabled: wantRates,
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });
  const query = wantRates ? priced : plain;
  const data = query.data;
  const showRates = wantRates && Boolean(data?.rateTotals);
  const partyName = useQuery({ ...trpc.customer.get.queryOptions({ id: search.party ?? "" }), enabled: Boolean(search.party), staleTime: 60_000 });
  const statusText = (v: "open" | OrdersShow) =>
    t(v === "open" ? "reports.orders.statusOpen" : v === "closed" ? "reports.orders.statusClosed" : v === "cancelled" ? "reports.orders.statusCancelled" : "reports.orders.allStatuses");
  const months = monthNames(t);
  const set = (patch: Partial<OrdersReportSearch>) => {
    const next: OrdersReportSearch = { ...search, ...patch };
    for (const k of Object.keys(next) as (keyof OrdersReportSearch)[]) if (next[k] === undefined || next[k] === false) delete next[k];
    onSearch(next);
  };

  return (
    <>
      <ReportPrintStyle />
      <PageHeader
        title={t("reports.orders.title")}
        subtitle={t("reports.orders.subtitle")}
        back={{ to: "/reports", label: t("reports.title") }}
        actions={
          <div className="report-no-print flex flex-wrap gap-2">
            <ReportActions csv={() => (data ? { name: csvFileName(t("reports.orders.csvName"), search.from, search.to), text: ordersCsv(data, t, showRates) } : null)} />
          </div>
        }
      />

      <ReportPrintContext
        parts={[
          group === "month" ? t("reports.orders.byMonth") : t("reports.orders.byParty"),
          search.late ? t("reports.orders.lateOnly") : statusText(show),
          partyName.data?.name,
          search.from || search.to ? `${search.from ?? ""} – ${search.to ?? ""}` : null,
        ]}
      />

      <div className="report-no-print flex min-w-0 flex-col gap-3" role="group" aria-label={t("common.filter")}>
        <SegmentedControl
          label={t("reports.orders.groupBy")}
          value={group}
          onChange={(v) => set({ group: v === "customer" ? undefined : v })}
          options={[
            { value: "customer", label: t("reports.orders.byParty") },
            { value: "month", label: t("reports.orders.byMonth") },
          ]}
        />
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t("reports.orders.status")}>
            <NativeSelect
              value={show}
              disabled={Boolean(search.late)}
              onChange={(e) => set({ show: e.currentTarget.value === "open" ? undefined : (e.currentTarget.value as OrdersShow) })}
              aria-label={t("reports.orders.status")}
              data-testid="orders-status"
            >
              {(["open", "closed", "cancelled", "all"] as const).map((v) => (
                <option key={v} value={v}>
                  {statusText(v)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("reports.orders.party")}>
            <div className="flex min-w-0 gap-2">
              <div className="min-w-0 flex-1">
                <Combobox<string>
                  value={search.party ?? null}
                  valueLabel={partyName.data?.name}
                  onChange={(id) => set({ party: id })}
                  search={async (q) => {
                    const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
                    return res.items.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }));
                  }}
                  placeholder={t("reports.orders.allParties")}
                />
              </div>
              {search.party ? (
                <Button variant="ghost" onClick={() => set({ party: undefined })}>
                  {t("reports.clear")}
                </Button>
              ) : null}
            </div>
          </Field>
          <Field label={t("reports.from")}>
            <TextInput type="date" value={search.from ?? ""} onChangeText={(v) => set({ from: v || undefined })} />
          </Field>
          <Field label={t("reports.to")}>
            <TextInput type="date" value={search.to ?? ""} onChangeText={(v) => set({ to: v || undefined })} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <ReportToggle id="orders-late" checked={Boolean(search.late)} onChange={(v) => set({ late: v })} label={t("reports.orders.lateOnly")} />
          {plain.data?.ratesAllowed ? (
            <ReportToggle id="orders-rates" checked={Boolean(search.rates)} onChange={(v) => set({ rates: v })} label={t("reports.orders.showRates")} />
          ) : null}
        </div>
      </div>

      {showsQueryError(query) ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("reports.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      ) : !data ? (
        <Skeleton className="h-48 rounded-card" />
      ) : data.rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-card">
          <EmptyState title={t("reports.orders.empty")} />
        </div>
      ) : (
        <>
          <ReportTableFrame label={t("reports.orders.title")}>
            <table data-testid="orders-report-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
              <caption className="sr-only">{t("reports.orders.title")}</caption>
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className={TH}>
                    {group === "month" ? t("reports.orders.month") : t("reports.orders.party")}
                  </th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.orders")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.late")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.ordered")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.dispatched")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.baki")}</th>
                  <th scope="col" className={`${TH} text-right`}>{t("reports.orders.dispatchedShare")}</th>
                  {showRates ? (
                    <>
                      <th scope="col" className={`${TH} text-right`} data-testid="rate-column">{t("reports.orders.orderedValue")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("reports.orders.dispatchedValue")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("reports.orders.bakiValue")}</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-b border-border last:border-0" data-key={r.key}>
                    <th scope="row" className={`${TD} min-w-[9rem] font-medium`}>
                      {ordersRowName(r, group, months)}
                    </th>
                    <td className={`${TD} ${NUM}`}>{r.orders}</td>
                    <td className={`${TD} ${NUM} ${r.lateOrders > 0 ? "font-semibold text-destructive" : ""}`}>{r.lateOrders}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.orderedG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.dispatchedG)}</td>
                    <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(r.bakiG)}</td>
                    <td className={`${TD} ${NUM}`}>{r.dispatchedPct}</td>
                    {showRates && r.rates ? (
                      <>
                        <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(r.rates.orderedValuePaise)}</td>
                        <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(r.rates.dispatchedValuePaise)}</td>
                        <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(r.rates.bakiValuePaise)}</td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold" data-testid="orders-report-totals">
                  <th scope="row" className={TD}>
                    {t("reports.total")}
                  </th>
                  <td className={`${TD} ${NUM}`}>{data.sum.orders}</td>
                  <td className={`${TD} ${NUM}`}>{data.sum.lateOrders}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.sum.orderedG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.sum.dispatchedG)}</td>
                  <td className={`${TD} ${NUM} whitespace-nowrap`}>{kgText(data.sum.bakiG)}</td>
                  <td className={`${TD} ${NUM}`}>{data.sum.dispatchedPct}</td>
                  {showRates && data.rateTotals ? (
                    <>
                      <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(data.rateTotals.orderedValuePaise)}</td>
                      <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(data.rateTotals.dispatchedValuePaise)}</td>
                      <td className={`${TD} ${NUM} whitespace-nowrap`}>{rupeeText(data.rateTotals.bakiValuePaise)}</td>
                    </>
                  ) : null}
                </tr>
              </tfoot>
            </table>
          </ReportTableFrame>
          {data.truncated ? <p className="m-0 text-[13px] text-muted-foreground">{t("reports.orders.truncated", { count: data.rows.length })}</p> : null}
          {showRates && data.rateTotals && data.rateTotals.rateMissingLines > 0 ? (
            <p className="m-0 text-[13px] text-muted-foreground">{t("reports.orders.rateMissing", { count: data.rateTotals.rateMissingLines })}</p>
          ) : null}
          {group === "month" ? (
            <Can do="analytics.view">
              <div className="report-no-print">
                <Suspense fallback={<Skeleton className="h-56 rounded-card" />}>
                  <OrderMonthsChart data={data} to={search.to} />
                </Suspense>
              </div>
            </Can>
          ) : null}
        </>
      )}
    </>
  );
}
