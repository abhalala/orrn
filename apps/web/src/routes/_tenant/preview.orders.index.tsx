import { Badge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PreviewFrame } from "@/features/preview/preview-frame";
import { previewModule } from "@/features/preview/registry";
import {
  customerName,
  formatOrderKg,
  formatPcs,
  orderStatusLabel,
  orderStatusTone,
  type SalesOrder,
} from "@/features/preview/orders/fixtures";
import { balanceOf, useOrdersDemo } from "@/features/preview/orders/store";

const mod = previewModule("orders")!;

export const Route = createFileRoute("/_tenant/preview/orders/")({
  component: OrdersPreview,
});

function OrdersPreview() {
  const demo = useOrdersDemo();
  const navigate = useNavigate();
  const [segment, setSegment] = useState<"open" | "closed">("open");
  const [search, setSearch] = useState("");
  const [stopped, setStopped] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return demo.orders.filter((order) => {
      const open = order.status !== "closed" && order.status !== "cancelled";
      if (segment === "open" ? !open : open) return false;
      if (!q) return true;
      const customer = customerName(order.customerId).toLowerCase();
      return (
        order.number.toLowerCase().includes(q) ||
        order.poNumber.toLowerCase().includes(q) ||
        customer.includes(q)
      );
    });
  }, [demo.orders, search, segment]);

  function openOrder(order: SalesOrder) {
    if (!order.openDetail) {
      setStopped("Preview stops at SO-12 and SO-14.");
      return;
    }
    setStopped(null);
    void navigate({ to: "/preview/orders/$id", params: { id: order.number } });
  }

  const columns: DataTableColumn<SalesOrder>[] = [
    {
      id: "number",
      header: "Sales order",
      sortable: true,
      sortValue: (row) => row.number,
      cell: (row) =>
        row.openDetail ? (
          <Link to="/preview/orders/$id" params={{ id: row.number }} className="font-mono font-semibold tabular-nums no-underline">
            {row.number}
          </Link>
        ) : (
          <span className="font-mono font-semibold tabular-nums">{row.number}</span>
        ),
    },
    {
      id: "customer",
      header: "Customer",
      sortable: true,
      sortValue: (row) => customerName(row.customerId),
      cell: (row) => customerName(row.customerId),
    },
    {
      id: "po",
      header: "PO",
      cell: (row) => <span className="font-mono tabular-nums">{row.poNumber || "—"}</span>,
    },
    {
      id: "status",
      header: "Status",
      cell: (row) => <Chip tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status)}</Chip>,
    },
    {
      id: "date",
      header: "Order date",
      sortable: true,
      sortValue: (row) => row.orderDateLabel,
      cell: (row) => row.orderDateLabel,
    },
    {
      id: "balance",
      header: "Balance",
      align: "right",
      sortable: true,
      sortValue: (row) => balanceOf(demo, row).g,
      cell: (row) => {
        const balance = balanceOf(demo, row);
        return (
          <span className="inline-flex flex-wrap justify-end gap-1">
            <Badge tone={balance.g > 0 ? "warning" : "success"} className="font-mono tabular-nums">
              {formatOrderKg(balance.g)} kg / {formatPcs(balance.pcs)} pcs
            </Badge>
          </span>
        );
      },
    },
  ];

  return (
    <PreviewFrame
      title="Orders"
      summary="Balance still to dispatch"
      featureIds={["FP-OP-01", "FP-OP-05", "FP-OP-07"]}
      specPath={mod.specPath}
      actions={
        <>
          <Button variant="secondary" asChild>
            <Link to="/preview/orders/plan">Press plan</Link>
          </Button>
          <Button asChild>
            <Link to="/preview/orders/new">New sales order</Link>
          </Button>
        </>
      }
    >
      <div className="flex min-w-0 flex-col gap-4">
        {stopped ? (
          <p
            role="status"
            className="m-0 rounded-card border border-border bg-surface-sunken px-3 py-2 text-[14px] font-medium leading-5"
          >
            {stopped}
          </p>
        ) : null}
        <Toolbar>
          <SegmentedControl
            label="Show"
            value={segment}
            onChange={setSegment}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
            ]}
          />
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Number, PO, or customer"
            aria-label="Search sales orders"
            className="sm:max-w-[280px]"
          />
        </Toolbar>
        {segment === "closed" ? (
          <EmptyState title="No closed sales orders" body="Closed sales orders leave this list. None are closed in this sample." />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(row) => row.number}
            onRowPress={openOrder}
            emptyState={
              <EmptyState
                title={search.trim() ? "No sales orders match" : "No sales orders yet"}
                body={search.trim() ? "Try another number, PO, or customer." : "Book a party's PO to start a sales order."}
              />
            }
            renderCard={(row) => {
              const balance = balanceOf(demo, row);
              return (
                <ListCard
                  mono
                  title={
                    row.openDetail ? (
                      <Link to="/preview/orders/$id" params={{ id: row.number }} className={stretchedLink}>
                        {row.number}
                      </Link>
                    ) : (
                      <button type="button" className={stretchedLink} onClick={() => openOrder(row)}>
                        {row.number}
                      </button>
                    )
                  }
                  titleText={row.number}
                  subtitle={customerName(row.customerId)}
                  status={<Chip tone={orderStatusTone(row.status)}>{orderStatusLabel(row.status)}</Chip>}
                  facts={[
                    { label: "PO", value: row.poNumber || "No PO yet", mono: true },
                    { label: "Order date", value: row.orderDateLabel },
                    { label: "Balance kg", value: formatOrderKg(balance.g), mono: true },
                    { label: "Balance pcs", value: formatPcs(balance.pcs), mono: true },
                  ]}
                />
              );
            }}
          />
        )}
      </div>
    </PreviewFrame>
  );
}
