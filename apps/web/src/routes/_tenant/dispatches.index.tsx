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

import { Can } from "@/shared/components/can";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];
type StatusFilter = DispatchStatus | "all";

export const Route = createFileRoute("/_tenant/dispatches/")({
  component: DispatchesListComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
  }),
  beforeLoad: requireCompanyMe,
});

type DispatchRow = {
  id: string;
  code: string;
  customerName: string;
  status: string;
  itemCount: number | string;
  totalWeightG: number | string;
  shipDate: string | number | Date | null;
  createdAt: string | number | Date;
};

function DispatchesListComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const status = search.status ?? "all";

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({
      search: query || undefined,
      status: status === "all" ? undefined : status,
      limit: 100,
      offset: 0,
    }),
  });

  const items = (data?.items ?? []) as DispatchRow[];

  const columns: DataTableColumn<DispatchRow>[] = [
    {
      id: "code",
      header: "Code",
      cell: (r) => (
        <Link
          to="/dispatches/$id"
          params={{ id: r.id }}
          className="font-mono text-xs hover:underline"
        >
          {r.code}
        </Link>
      ),
    },
    { id: "customer", header: "Customer", cell: (r) => r.customerName, flex: 2 },
    { id: "status", header: "Status", cell: (r) => <StatusBadge kind="dispatch" value={r.status} /> },
    { id: "items", header: "Items", align: "right", cell: (r) => Number(r.itemCount) },
    {
      id: "weight",
      header: "Weight (g)",
      align: "right",
      cell: (r) => Number(r.totalWeightG).toLocaleString(),
    },
    {
      id: "ship",
      header: "Ship Date",
      cell: (r) => (r.shipDate ? format(new Date(r.shipDate), "MMM d, yyyy") : "—"),
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
        title="Dispatches"
        description={`Outbound shipments and reservations (${data?.total ?? 0} total)`}
        actions={
          <Can do="dispatch.create">
            <Link to="/dispatches/new">
              <Button>New Dispatch</Button>
            </Link>
          </Can>
        }
      />

      <Toolbar>
        <Input
          placeholder="Search by code or notes…"
          value={query}
          onChangeText={setQuery}
          className="max-w-80"
        />
        <Tabs
          value={status}
          onValueChange={(v) => navigate({ search: { status: v as StatusFilter } })}
          items={(["all", ...dispatchStatuses] as const).map((s) => ({
            id: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
          }))}
        />
      </Toolbar>

      <DataTable
        rows={items}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to="/dispatches/$id" params={{ id: r.id }} className="font-mono text-sm font-semibold hover:underline">
                  {r.code}
                </Link>
                <p className="m-0 truncate text-sm text-muted-foreground">{r.customerName}</p>
              </div>
              <StatusBadge kind="dispatch" value={r.status} />
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Items</p>
                <p className="m-0 text-foreground">{Number(r.itemCount)}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Weight</p>
                <p className="m-0 text-foreground">{Number(r.totalWeightG).toLocaleString()} g</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Ship</p>
                <p className="m-0 text-foreground">{r.shipDate ? format(new Date(r.shipDate), "MMM d") : "—"}</p>
              </div>
            </div>
            <p className="m-0 border-t border-border pt-3 text-xs text-muted-foreground">
              Created {format(new Date(r.createdAt), "MMM d, yyyy")}
            </p>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No dispatches yet"
            description="Create a draft dispatch to start reserving bundles for a customer."
            actions={
              <Can do="dispatch.create">
                <Link to="/dispatches/new">
                  <Button>New dispatch</Button>
                </Link>
              </Can>
            }
          />
        }
      />
    </div>
  );
}
