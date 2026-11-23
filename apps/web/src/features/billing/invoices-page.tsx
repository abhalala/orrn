/** `/billing`: the invoice and credit note list, with the accounts exports under it. */
import { kgQtyText } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { ExportsCard } from "./exports-card";
import { DOC_STATUSES, type DocKind, type DocStatus } from "./model";
import { BillingTabs, Rupees, StatusChip } from "./ui";

type KindTab = "all" | DocKind;
type StatusTab = "all" | DocStatus;

export function InvoicesPage() {
  const { t } = useT();
  const fmt = useFmt();
  const [kind, setKind] = useState<KindTab>("all");
  const [status, setStatus] = useState<StatusTab>("all");

  const list = useQuery({
    ...trpc.billing.invoices.list.queryOptions({ kind: kind === "all" ? undefined : kind, status: status === "all" ? undefined : status, limit: 100 }),
    placeholderData: keepPreviousData,
  });
  type Row = NonNullable<typeof list.data>[number];

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "number",
      header: t("bill.list.number"),
      cell: (r) => (
        <span className="font-mono whitespace-nowrap">
          {r.number ?? t("bill.list.notNumbered")}
          {r.kind === "credit_note" ? <span className="ml-2 text-xs text-muted-foreground">{t("bill.kind.credit_note")}</span> : null}
        </span>
      ),
    },
    { key: "date", header: t("bill.list.date"), cell: (r) => (r.invoiceDate ? bookDateText(fmt, r.invoiceDate) : <span className="text-muted-foreground">-</span>) },
    { key: "customer", header: t("bill.list.customer"), cell: (r) => r.customerName },
    { key: "kg", header: t("bill.list.kg"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{kgQtyText(r.weightG)}</span> },
    { key: "total", header: t("bill.list.total"), align: "end", cell: (r) => <Rupees paise={r.totalPaise} /> },
    {
      key: "status",
      header: t("bill.list.status"),
      phoneWide: true,
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <StatusChip status={r.status} kind={r.kind} />
          {r.ewbStatus === "active" ? <Chip tone="blue">{t("bill.list.ewb")}</Chip> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title={t("bill.title")}
        subtitle={t("bill.subtitle")}
        actions={
          <Can do="invoice.issue">
            <Button asChild className="max-md:h-14 max-md:w-full max-md:text-[17px]">
              <Link to="/billing/new">
                <Plus aria-hidden="true" strokeWidth={2} />
                {t("bill.list.newInvoice")}
              </Link>
            </Button>
          </Can>
        }
      />
      <BillingTabs current="invoices" />
      <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center">
        <SegmentedControl
          label={t("bill.list.kindLabel")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "all" as KindTab, label: t("bill.list.kindAll") },
            { value: "invoice" as KindTab, label: t("bill.kind.invoice") },
            { value: "credit_note" as KindTab, label: t("bill.kind.credit_note") },
          ]}
        />
        <SegmentedControl
          label={t("bill.list.statusLabel")}
          value={status}
          onChange={setStatus}
          options={[{ value: "all" as StatusTab, label: t("bill.list.statusAll") }, ...DOC_STATUSES.map((s) => ({ value: s as StatusTab, label: t(`bill.status.${s}`) }))]}
        />
      </div>

      {list.isError && !list.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("bill.list.loadError")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <ResponsiveList<Row>
          label={t("bill.list.label")}
          rows={list.data ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/billing/${r.id}`}
          columns={columns}
          loading={list.isFetching}
          empty={
            <EmptyState
              title={t("bill.list.empty")}
              action={
                <Can do="invoice.issue">
                  <Button asChild>
                    <Link to="/billing/new">{t("bill.list.newInvoice")}</Link>
                  </Button>
                </Can>
              }
            />
          }
        />
      )}

      <Can do="export.accounts">
        <ExportsCard />
      </Can>
    </>
  );
}
