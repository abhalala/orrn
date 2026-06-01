import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";

import { Can } from "@/shared/components/can";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/receipts/")({
  component: ReceiptsListComponent,
  beforeLoad: requireCompanyMe,
});

type ReceiptRow = {
  id: string;
  code: string;
  dieSeries: string;
  dieSectionCode: string;
  unit: string;
  purchaseOrderRef: string | null;
  bundleCount: number | string;
  totalWeightG: number | string;
  createdAt: string | number | Date;
};

function ReceiptsListComponent() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listGroups.queryOptions({ search, limit: 50, offset: 0 }),
  });

  const columns: DataTableColumn<ReceiptRow>[] = [
    {
      id: "code",
      header: "Code",
      cell: (r) => (
        <Link to="/receipts/$id" params={{ id: r.id }} className="font-mono text-xs hover:underline">
          {r.code}
        </Link>
      ),
    },
    {
      id: "die",
      header: "Die",
      cell: (r) => (
        <span className="text-sm">
          {r.dieSeries} / {r.dieSectionCode}
        </span>
      ),
    },
    { id: "unit", header: "Unit", cell: (r) => r.unit },
    { id: "po", header: "PO Ref", cell: (r) => r.purchaseOrderRef || "—" },
    {
      id: "bundles",
      header: "Bundles",
      align: "right",
      cell: (r) => Number(r.bundleCount),
    },
    {
      id: "weight",
      header: "Total Weight (g)",
      align: "right",
      cell: (r) => Number(r.totalWeightG).toLocaleString(),
    },
    {
      id: "created",
      header: "Created",
      cell: (r) => format(new Date(r.createdAt), "MMM d, yyyy"),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        description={`Production receipts (bundle groups) — ${data?.total ?? 0} total`}
        actions={
          <Can do="receipt.create">
            <Link to="/receipts/new">
              <Button>New Production Receipt</Button>
            </Link>
          </Can>
        }
      />

      <Toolbar>
        <Input
          placeholder="Search by receipt code or PO ref…"
          value={search}
          onChangeText={setSearch}
          className="max-w-[360px]"
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as ReceiptRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to="/receipts/$id" params={{ id: r.id }} className="font-mono text-sm font-semibold hover:underline">
                  {r.code}
                </Link>
                <p className="m-0 text-xs text-muted-foreground">
                  {r.dieSeries} / {r.dieSectionCode}
                </p>
              </div>
              <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-secondary-foreground">
                {Number(r.bundleCount)} bundles
              </span>
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Unit</p>
                <p className="m-0 text-foreground">{r.unit}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Weight</p>
                <p className="m-0 text-foreground">{Number(r.totalWeightG).toLocaleString()} g</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Created</p>
                <p className="m-0 text-foreground">{format(new Date(r.createdAt), "MMM d")}</p>
              </div>
            </div>
            <p className="m-0 border-t border-border pt-3 text-xs text-muted-foreground">
              PO ref: {r.purchaseOrderRef || "—"}
            </p>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No receipts yet"
            description="Create your first production receipt to spawn bundles for the floor."
            actions={
              <Can do="receipt.create">
                <Link to="/receipts/new">
                  <Button>New receipt</Button>
                </Link>
              </Can>
            }
          />
        }
      />
    </div>
  );
}
