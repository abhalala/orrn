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
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { useFmt } from "@/shared/lib/fmt";
import { kgGrouped1, massUnit, rupeeText } from "@/shared/lib/fmt-text";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { filterQuoteRows, quoteShownStatus, type QuoteListRow } from "./docs-model";
import { QUOTE_STATUS_FILTERS, type QuotesSearch } from "./search";

const PAGE = 50;
const TONE = { draft: "neutral", sent: "blue", converted: "green", cancelled: "red", expired: "amber" } as const;

type Row = QuoteListRow & { id: string; kgG: number; amountPaise: number };

/**
 * `/pricing/quotes`: the quotes, newest first. The server filters by status and customer (the URL); quote number or
 * customer text and a quote date range narrow the rows loaded. Kg and amount are in the table.
 */
export function QuotesPage({ search, onSearch }: { search: QuotesSearch; onSearch(next: QuotesSearch): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const [text, setText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const offset = search.offset ?? 0;
  const list = useQuery({
    ...trpc.pricing.quotes.list.queryOptions({ ...(search.status ? { status: search.status } : {}), ...(search.customer ? { customerId: search.customer } : {}), limit: PAGE, offset }),
    placeholderData: keepPreviousData,
  });
  const customerName = useQuery({ ...trpc.customer.get.queryOptions({ id: search.customer ?? "" }), enabled: Boolean(search.customer), staleTime: 60_000 });
  const all = (list.data?.items ?? []) as unknown as Row[];
  const rows = filterQuoteRows(all, { text, from, to });
  const set = (patch: Partial<QuotesSearch>) => onSearch({ ...search, offset: undefined, ...patch });
  const dash = <span className="text-muted-foreground">-</span>;

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("price.quotes.columns.number"), cell: (q) => <span className="font-mono font-semibold whitespace-nowrap">{q.number}</span> },
    { key: "customer", header: t("price.quotes.columns.customer"), cell: (q) => <span className="block max-w-[26ch] truncate" title={q.customerName}>{q.customerName}</span> },
    {
      key: "status",
      header: t("price.quotes.columns.status"),
      cell: (q) => {
        const s = quoteShownStatus(q);
        return (
          <Chip tone={TONE[s]} truncate={false}>
            {t(`price.quotes.status.${s}`)}
          </Chip>
        );
      },
    },
    { key: "date", header: t("price.quotes.columns.date"), hideOnPhone: true, cell: (q) => <span className="whitespace-nowrap">{fmt.day(q.quoteDate)}</span> },
    { key: "valid", header: t("price.quotes.columns.validUntil"), hideOnPhone: true, cell: (q) => (q.validUntil ? <span className="whitespace-nowrap">{fmt.day(q.validUntil)}</span> : dash) },
    { key: "kg", header: `${t("price.quotes.columns.weight")} ${massUnit(fmt)}`, align: "end", cell: (q) => <span className="font-mono tabular-nums">{kgGrouped1(fmt, q.kgG)}</span> },
    { key: "amount", header: t("price.quotes.columns.amount"), align: "end", cell: (q) => <span className="font-mono tabular-nums">{rupeeText(fmt, q.amountPaise)}</span> },
  ];

  const narrowed = text.trim() !== "" || from !== "" || to !== "";
  return (
    <>
      <PageHeader
        title={t("price.quotes.title")}
        subtitle={t("price.quotes.subtitle")}
        actions={
          <Can do="quote.manage">
            <Button asChild size="lg">
              <RouterLink to="/pricing/quotes/new">
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("price.quotes.new")}
              </RouterLink>
            </Button>
          </Can>
        }
      />
      <div className="flex min-w-0 flex-col gap-4">
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5" role="search" aria-label={t("price.quotes.filters.label")}>
          <Field label={t("price.quotes.filters.status")}>
            <NativeSelect
              value={search.status ?? ""}
              onChange={(e) => set({ status: (e.target.value || undefined) as QuotesSearch["status"] })}
            >
              <option value="">{t("price.quotes.filters.anyStatus")}</option>
              {QUOTE_STATUS_FILTERS.map((s) => (
                <option key={s} value={s}>
                  {t(`price.quotes.status.${s}`)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("price.quotes.filters.customer")}>
            <Combobox<string>
              value={search.customer ?? null}
              valueLabel={customerName.data?.name}
              onChange={(id) => set({ customer: id })}
              search={async (q) => {
                const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
                return res.items.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }));
              }}
              placeholder={t("price.quotes.filters.anyCustomer")}
            />
          </Field>
          <Field label={t("price.quotes.filters.text")}>
            <Input value={text} onChangeText={setText} placeholder={t("price.quotes.filters.textPlaceholder")} />
          </Field>
          <Field label={t("price.quotes.filters.from")}>
            <TextInput type="date" value={from} onChangeText={setFrom} />
          </Field>
          <Field label={t("price.quotes.filters.to")}>
            <TextInput type="date" value={to} onChangeText={setTo} />
          </Field>
        </div>
        {search.status || search.customer || narrowed ? (
          <div>
            <Button
              variant="ghost"
              onClick={() => {
                setText("");
                setFrom("");
                setTo("");
                onSearch({});
              }}
            >
              {t("price.quotes.filters.clear")}
            </Button>
          </div>
        ) : null}
        {list.isError && !list.data ? (
          <div role="alert" className="rounded-card border border-border bg-card">
            <EmptyState title={t("price.quotes.loadFailed")} action={<Button onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
          </div>
        ) : (
          <ResponsiveList
            rows={rows}
            columns={columns}
            rowKey={(q) => q.id}
            rowHref={(q) => `/pricing/quotes/${q.id}`}
            loading={list.isLoading}
            label={t("price.quotes.title")}
            empty={<EmptyState title={search.status || search.customer || narrowed ? t("price.quotes.noMatch") : t("price.quotes.empty")} />}
          />
        )}
        {offset > 0 || list.data?.nextOffset != null ? (
          <nav aria-label={t("price.quotes.pages")} className="flex justify-end gap-2">
            <Button variant="secondary" disabled={offset <= 0} onClick={() => onSearch({ ...search, offset: offset - PAGE > 0 ? offset - PAGE : undefined })}>
              {t("common.previousPage")}
            </Button>
            <Button variant="secondary" disabled={list.data?.nextOffset == null} onClick={() => onSearch({ ...search, offset: list.data?.nextOffset ?? undefined })}>
              {t("common.nextPage")}
            </Button>
          </nav>
        ) : null}
      </div>
    </>
  );
}
