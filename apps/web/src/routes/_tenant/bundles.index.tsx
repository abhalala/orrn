import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";

import { requireCompanyMe } from "@/shared/lib/guards";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];
type StatusFilter = BundleStatus | "all";

export const Route = createFileRoute("/_tenant/bundles/")({
  component: BundlesListComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
    dieId: (search.dieId as string | undefined) ?? undefined,
    groupId: (search.groupId as string | undefined) ?? undefined,
  }),
  beforeLoad: requireCompanyMe,
});

type BundleRow = {
  id: string;
  serial: string;
  dieSeries: string;
  dieSectionCode: string;
  groupId: string;
  groupCode: string;
  quantity: number | string;
  weightG: number | string;
  lengthMm: number | string;
  status: BundleStatus | string;
  createdAt: string | number | Date;
};

function BundlesListComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [serialSearch, setSerialSearch] = useState("");
  const lu = useLengthUnit();

  const status: StatusFilter = search.status ?? "all";

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      search: serialSearch || undefined,
      status: status === "all" ? undefined : status,
      dieId: search.dieId,
      groupId: search.groupId,
      limit: 100,
      offset: 0,
    }),
  });

  const columns: DataTableColumn<BundleRow>[] = [
    {
      id: "serial",
      header: "Serial",
      cell: (r) => (
        <Link to="/bundles/$id" params={{ id: r.id }} className="font-mono text-xs hover:underline">
          {r.serial}
        </Link>
      ),
      flex: 1.5,
    },
    {
      id: "die",
      header: "Die",
      cell: (r) => `${r.dieSeries} / ${r.dieSectionCode}`,
    },
    {
      id: "receipt",
      header: "Receipt",
      cell: (r) => (
        <Link to="/receipts/$id" params={{ id: r.groupId }} className="font-mono text-xs hover:underline">
          {r.groupCode}
        </Link>
      ),
    },
    { id: "qty", header: "Qty", align: "right", cell: (r) => Number(r.quantity) },
    { id: "weight", header: "Weight (g)", align: "right", cell: (r) => Number(r.weightG) },
    { id: "length", header: `Length (${lu.label})`, align: "right", cell: (r) => lu.formatLength(Number(r.lengthMm)) },
    {
      id: "status",
      header: "Status",
      cell: (r) => <StatusBadge kind="bundle" value={r.status} />,
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
        title="Bundles"
        description={`All bundles across receipts (${data?.total ?? 0} total)`}
        actions={
          <>
            <Link to="/receipts">
              <Button variant="outline">View Receipts</Button>
            </Link>
            <Link to="/receipts/new">
              <Button>New Production Receipt</Button>
            </Link>
          </>
        }
      />

      <Toolbar
        actions={
          (search.dieId || search.groupId) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate({ search: { status, dieId: undefined, groupId: undefined } })}
            >
              Clear filters
            </Button>
          )
        }
      >
        <Input
          placeholder="Search by serial…"
          value={serialSearch}
          onChangeText={setSerialSearch}
          className="max-w-80"
        />
        <Tabs
          value={status}
          onValueChange={(v) => navigate({ search: (prev) => ({ ...prev, status: v as StatusFilter }) })}
          items={(["all", ...bundleStatuses] as const).map((s) => ({
            id: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
          }))}
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as BundleRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No bundles found"
            description={
              search.dieId || search.groupId
                ? "Nothing matches the active filter."
                : "Bundles appear here once a receipt is created."
            }
          />
        }
      />
    </div>
  );
}
