/**
 * `/orders`: the order book at a glance (FP-OP-20). A header strip over the whole filter (open
 * orders, ordered, in stock, dispatched, baki), then one row per sales order with a kg bar of where
 * it stands. Filters are the URL's: party, city, status, order date range, stage and search. Figures
 * are the server's (`orders.list`: the strip is `totals` of the same answer as the rows); the Late
 * chip is the order's own `lateDays`. A phone shows each order as a card with the bar under its name.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Combobox } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Input } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { bookDateText } from "@/features/purchase/format";
import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import {
  activeBookFilters,
  BOOK_PAGE,
  BOOK_STAGES,
  bookQueryInput,
  lateRuleKey,
  withBookFilter,
  type Bar,
  type BookSearch,
  type BookShow,
} from "./book-view";
import { BookStrip } from "./components/book-strip";
import { BookExportButton } from "./components/print-buttons";
import { OrderBar } from "./components/order-bar";
import { listKgText } from "./format";
import { useDebounced } from "./hooks";
import { STATUS_TONE, type OrderStatus } from "./view";

type Scope = "open" | "late" | "closed" | "cancelled";
const OPEN_STATUSES = ["booking", "confirmed", "dispatching"] as const;

function scopeOf(show: BookShow | undefined): Scope {
  if (show === "late" || show === "closed" || show === "cancelled") return show;
  return "open";
}

type Row = {
  id: string;
  number: string;
  customerName: string;
  city: string | null;
  poNumber: string | null;
  orderDate: string;
  expectedDate: string | null;
  status: OrderStatus;
  orderedG: number;
  bakiG: number;
  lateDays: number | null;
  lateRule: string | null;
  bar: Bar;
};

export function OrdersPage({ search, onSearch }: { search: BookSearch; onSearch(next: BookSearch): void }) {
  const { t, locale } = useT();
  const [text, setText] = useState(search.q ?? "");
  const typed = useDebounced(text.trim(), 300);
  const set = (patch: Partial<Record<keyof BookSearch, string | number | undefined>>) => onSearch(withBookFilter(search, patch));

  // The search box types ahead of the URL; the URL follows once typing pauses.
  useEffect(() => {
    if (typed !== (search.q ?? "")) onSearch(withBookFilter(search, { q: typed || undefined }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed]);

  const page = Math.max(1, search.page ?? 1);
  const offset = (page - 1) * BOOK_PAGE;
  const list = useQuery({
    ...trpc.orders.list.queryOptions({ ...bookQueryInput(search), limit: BOOK_PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const cities = useQuery({ ...trpc.orders.bookCities.queryOptions(), staleTime: 60_000 });
  const partyName = useQuery({
    ...trpc.customer.get.queryOptions({ id: search.party ?? "" }),
    enabled: Boolean(search.party),
    staleTime: 60_000,
  });

  const rows = (list.data?.items ?? []) as unknown as Row[];
  const filters = activeBookFilters(search);
  const scope = scopeOf(search.show);

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "number",
      header: t("orders.number"),
      cell: (o) => <span className="font-mono font-semibold whitespace-nowrap">{o.number}</span>,
    },
    {
      key: "customer",
      header: t("orders.customer"),
      cell: (o) => (
        <span className="flex min-w-0 flex-col">
          <span className="max-w-[26ch] truncate" title={o.customerName}>
            {o.customerName}
          </span>
          {o.city ? (
            <span className="max-w-[26ch] truncate text-[13px] text-muted-foreground" title={o.city}>
              {o.city}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "po",
      header: t("orders.po"),
      // The PO is the document: its own cell, one line (cut with an ellipsis, the whole number in the title), never wrapped letter by letter.
      cell: (o) =>
        o.poNumber ? (
          <span className="block max-w-[22ch] truncate font-mono" title={o.poNumber} data-po="">
            {o.poNumber}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("orders.noPo")}</span>
        ),
    },
    {
      key: "status",
      header: t("orders.list.status"),
      cell: (o) => {
        // Review m-1: the server marks each order's late days (`lateDays`), never a capped list.
        const days = o.lateDays;
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip tone={STATUS_TONE[o.status]} truncate={false}>
              {t(`orders.status.${o.status}`)}
            </Chip>
            {days != null ? (
              <Chip tone="red" truncate={false} title={t(lateRuleKey(o.lateRule))}>
                {t("orders.late", { days })}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "bar",
      header: t("orders.book.bar.column"),
      phoneWide: true,
      cell: (o) => <OrderBar number={o.number} bar={o.bar} orderedG={o.orderedG} bakiG={o.bakiG} />,
    },
    {
      key: "date",
      header: t("orders.orderDate"),
      hideOnPhone: true,
      cell: (o) => (
        <span className="flex flex-col whitespace-nowrap">
          <span>{bookDateText(o.orderDate, locale)}</span>
          {o.expectedDate ? <span className="text-[13px] text-muted-foreground">{t("orders.book.due", { date: bookDateText(o.expectedDate, locale) })}</span> : null}
        </span>
      ),
    },
    {
      key: "ordered",
      header: t("orders.list.ordered"),
      align: "end",
      hideOnPhone: true,
      cell: (o) => <span className="font-mono tabular-nums">{listKgText(o.orderedG)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        subtitle={t("orders.subtitle")}
        actions={
          <>
            <Can do="reports.read">
              <BookExportButton input={bookQueryInput(search)} />
            </Can>
            <Can do="order.plan">
              <Button variant="secondary" asChild>
                <RouterLink to="/orders/plan">{t("press.plan.title")}</RouterLink>
              </Button>
            </Can>
            <Can do="order.manage">
              <Button asChild size="lg">
                <RouterLink to="/orders/new">
                  <Plus aria-hidden="true" strokeWidth={2} />
                  {t("orders.new")}
                </RouterLink>
              </Button>
            </Can>
          </>
        }
      />

      <div className="flex min-w-0 flex-col gap-4">
        <BookStrip totals={list.data?.totals} loading={list.isPending} />

        <div className="flex min-w-0 flex-col gap-3" role="search" aria-label={t("orders.book.filter.label")}>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl<Scope>
              label={t("orders.filter.label")}
              value={scope}
              onChange={(v) => set({ show: v === "open" ? undefined : v })}
              options={[
                { value: "open", label: t("orders.filter.open") },
                { value: "late", label: t("orders.book.show.late") },
                { value: "closed", label: t("orders.filter.closed") },
                { value: "cancelled", label: t("orders.filter.cancelled") },
              ]}
            />
            {scope === "open" ? (
              <NativeSelect
                aria-label={t("orders.book.filter.status")}
                value={OPEN_STATUSES.includes(search.show as (typeof OPEN_STATUSES)[number]) ? search.show : ""}
                onChange={(e) => set({ show: e.target.value || undefined })}
                className="sm:max-w-[200px]"
              >
                <option value="">{t("orders.book.filter.anyOpen")}</option>
                {OPEN_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orders.status.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            ) : null}
            <Input
              value={text}
              onChangeText={setText}
              placeholder={t("orders.search")}
              aria-label={t("orders.searchLabel")}
              className="sm:max-w-[280px]"
            />
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label={t("orders.book.filter.party")}>
              <Combobox<string>
                value={search.party ?? null}
                valueLabel={partyName.data?.name}
                onChange={(id) => set({ party: id })}
                search={async (q) => {
                  const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
                  return res.items.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }));
                }}
                placeholder={t("orders.book.filter.anyParty")}
              />
            </Field>
            <Field label={t("orders.book.filter.city")}>
              <NativeSelect value={search.city ?? ""} onChange={(e) => set({ city: e.target.value || undefined })} aria-label={t("orders.book.filter.city")}>
                <option value="">{t("orders.book.filter.anyCity")}</option>
                {(cities.data ?? []).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field label={t("orders.book.filter.from")}>
              <TextInput type="date" value={search.from ?? ""} onChangeText={(v) => set({ from: v || undefined })} />
            </Field>
            <Field label={t("orders.book.filter.to")}>
              <TextInput type="date" value={search.to ?? ""} onChangeText={(v) => set({ to: v || undefined })} />
            </Field>
            <Field label={t("orders.book.filter.stage")}>
              <NativeSelect value={search.stage ?? ""} onChange={(e) => set({ stage: e.target.value || undefined })} aria-label={t("orders.book.filter.stage")}>
                <option value="">{t("orders.book.filter.anyStage")}</option>
                {BOOK_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {t(`orders.book.stage.${s}`)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          {filters > 0 || (search.show && search.show !== "open") ? (
            <div>
              <Button
                variant="ghost"
                onClick={() => {
                  setText("");
                  onSearch({});
                }}
              >
                {t("orders.book.filter.clear")}
              </Button>
            </div>
          ) : null}
        </div>

        {list.isError && list.data === undefined ? (
          <div role="alert" className="flex flex-col items-start gap-3 rounded-card border border-border bg-card p-5">
            <p className="m-0 text-[15px] font-medium">{t("errors.generic")}</p>
            <Button variant="secondary" onClick={() => void list.refetch()}>
              {t("common.retry")}
            </Button>
          </div>
        ) : (
          <ResponsiveList<Row>
            label={t("orders.title")}
            rows={rows}
            columns={columns}
            rowKey={(o) => o.id}
            rowHref={(o) => `/orders/${o.id}`}
            loading={list.isPending}
            total={list.data?.total}
            page={{ offset, limit: BOOK_PAGE, onChange: (next) => set({ page: Math.floor(next / BOOK_PAGE) + 1 }) }}
            empty={
              filters > 0 ? (
                <EmptyState title={t("orders.empty.noMatch")} body={t("orders.empty.noMatchBody")} />
              ) : scope === "open" ? (
                <EmptyState title={t("orders.empty.title")} body={t("orders.empty.body")} />
              ) : (
                <EmptyState title={t("orders.empty.filtered", { status: t(`orders.book.show.${scope}`) })} />
              )
            }
          />
        )}
      </div>
    </>
  );
}
