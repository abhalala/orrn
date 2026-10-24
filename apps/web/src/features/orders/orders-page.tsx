/**
 * `/orders`: customer POs, open first, with what is still to dispatch. Figures are the server's
 * (`orders.list`); the Late chip comes from `orders.late`. A phone shows the same list as cards.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { bookDateText } from "@/features/purchase/format";
import { Can } from "@/shared/components/can";
import { RouterLink } from "@/shared/components/router-link";
import { trpc } from "@/shared/utils/trpc";

import { orderKgText } from "./format";
import { useDebounced } from "./hooks";
import { STATUS_TONE, type OrderStatus } from "./view";

type Show = "open" | "closed" | "cancelled";
const PAGE = 25;

type Row = {
  id: string;
  number: string;
  customerName: string;
  poNumber: string | null;
  orderDate: string;
  status: OrderStatus;
  orderedG: number;
  bakiG: number;
};

export function OrdersPage() {
  const { t, locale } = useT();
  const [show, setShow] = useState<Show>("open");
  const [text, setText] = useState("");
  const [offset, setOffset] = useState(0);
  const search = useDebounced(text.trim(), 300);

  const list = useQuery({
    ...trpc.orders.list.queryOptions({
      ...(show === "open" ? { openOnly: true } : { status: show }),
      ...(search ? { search } : {}),
      limit: PAGE,
      offset,
    }),
    placeholderData: keepPreviousData,
  });
  const late = useQuery({ ...trpc.orders.late.queryOptions({ limit: 500 }), staleTime: 30_000 });
  const daysLate = useMemo(() => {
    const byOrder = new Map<string, number>();
    for (const l of late.data?.lines ?? []) byOrder.set(l.orderId, Math.max(byOrder.get(l.orderId) ?? 0, l.daysOpen));
    return byOrder;
  }, [late.data]);

  const rows = (list.data?.items ?? []) as Row[];

  const columns: ResponsiveListColumn<Row>[] = [
    {
      key: "number",
      header: t("orders.number"),
      cell: (o) => <span className="font-mono font-semibold whitespace-nowrap">{o.number}</span>,
    },
    { key: "customer", header: t("orders.customer"), cell: (o) => o.customerName },
    {
      key: "po",
      header: t("orders.po"),
      // The PO is the document: its own cell, never cut short by the customer's name.
      cell: (o) => (o.poNumber ? <span className="font-mono break-all">{o.poNumber}</span> : <span className="text-muted-foreground">{t("orders.noPo")}</span>),
    },
    {
      key: "status",
      header: t("orders.list.status"),
      cell: (o) => {
        const days = daysLate.get(o.id);
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <Chip tone={STATUS_TONE[o.status]} truncate={false}>
              {t(`orders.status.${o.status}`)}
            </Chip>
            {days != null ? (
              <Chip tone="red" truncate={false}>
                {t("orders.late", { days })}
              </Chip>
            ) : null}
          </span>
        );
      },
    },
    {
      key: "date",
      header: t("orders.orderDate"),
      hideOnPhone: true,
      cell: (o) => <span className="whitespace-nowrap">{bookDateText(o.orderDate, locale)}</span>,
    },
    {
      key: "ordered",
      header: t("orders.list.ordered"),
      align: "end",
      hideOnPhone: true,
      cell: (o) => <span className="font-mono tabular-nums">{orderKgText(o.orderedG)}</span>,
    },
    {
      key: "baki",
      header: t("orders.list.baki"),
      align: "end",
      cell: (o) => <span className="font-mono tabular-nums">{orderKgText(o.bakiG)}</span>,
    },
  ];

  return (
    <>
      <PageHeader
        title={t("orders.title")}
        subtitle={t("orders.subtitle")}
        actions={
          <>
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
      <Toolbar>
        <SegmentedControl<Show>
          label={t("orders.filter.label")}
          value={show}
          onChange={(v) => {
            setShow(v);
            setOffset(0);
          }}
          options={[
            { value: "open", label: t("orders.filter.open") },
            { value: "closed", label: t("orders.filter.closed") },
            { value: "cancelled", label: t("orders.filter.cancelled") },
          ]}
        />
        <Input
          value={text}
          onChangeText={(v) => {
            setText(v);
            setOffset(0);
          }}
          placeholder={t("orders.search")}
          aria-label={t("orders.searchLabel")}
          className="sm:max-w-[280px]"
        />
      </Toolbar>
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
          page={{ offset, limit: PAGE, onChange: setOffset }}
          empty={
            search ? (
              <EmptyState title={t("orders.empty.noMatch")} body={t("orders.empty.noMatchBody")} />
            ) : show === "open" ? (
              <EmptyState title={t("orders.empty.title")} body={t("orders.empty.body")} />
            ) : (
              <EmptyState title={t("orders.empty.filtered", { status: t(`orders.filter.${show}`) })} />
            )
          }
        />
      )}
    </>
  );
}
