import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
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
import { formatKgTotal, kgTotalValue } from "@/shared/lib/weight";

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
    { id: "po", header: "PO Ref", cell: (r) => r.purchaseOrderRef || "None" },
    {
      id: "bundles",
      header: "Bundles",
      align: "right",
      cell: (r) => Number(r.bundleCount),
    },
    {
      id: "weight",
      header: "Weight (kg)",
      align: "right",
      cell: (r) => kgTotalValue(r.totalWeightG),
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
        title="Packing"
        description={`Each packing session records one press run and the bundles it made (${data?.total ?? 0} in total).`}
        actions={
          <Can do="receipt.create">
            <Button asChild>
              <Link to="/receipts/new">New packing session</Link>
            </Button>
          </Can>
        }
      />

      <Toolbar>
        <Input
          placeholder="Search by session code or PO ref…"
          value={search}
          onChangeText={setSearch}
          aria-label="Search packing sessions"
          className="sm:max-w-[360px]"
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as ReceiptRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <ListCard
            mono
            title={
              <Link to="/receipts/$id" params={{ id: r.id }} className={stretchedLink}>
                {r.code}
              </Link>
            }
            subtitle={`${r.dieSeries} / ${r.dieSectionCode}`}
            facts={[
              { label: "Bundles", value: Number(r.bundleCount).toLocaleString() },
              { label: "Weight", value: formatKgTotal(r.totalWeightG) },
              { label: "Created", value: format(new Date(r.createdAt), "MMM d") },
            ]}
            footer={
              <span className="min-w-0 truncate" title={r.purchaseOrderRef ?? undefined}>
                PO ref: {r.purchaseOrderRef || "None"}
              </span>
            }
          />
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No packing sessions yet"
            description="Start a packing session to create bundles and print their labels."
            actions={
              <Can do="receipt.create">
                <Button asChild>
                  <Link to="/receipts/new">New session</Link>
                </Button>
              </Can>
            }
          />
        }
      />
    </div>
  );
}
