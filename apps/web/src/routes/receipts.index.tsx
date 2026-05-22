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

import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/receipts/")({
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
          maxWidth={360}
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as ReceiptRow[]}
        rowKey={(r) => r.id}
        columns={columns}
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
