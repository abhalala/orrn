import { Badge } from "@orrn/ui/components/badge";
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
import { ImportDiesModal } from "@/shared/components/import-dies-modal";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dies/")({
  component: DiesListComponent,
  beforeLoad: requireCompanyMe,
});

type DieRow = {
  id: string;
  series: string;
  sectionCode: string;
  name: string | null;
  status: string;
  createdAt: string | number | Date;
};

function DiesListComponent() {
  const [search, setSearch] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    ...trpc.die.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  const columns: DataTableColumn<DieRow>[] = [
    {
      id: "series",
      header: "Series",
      sortable: true,
      sortValue: (r) => r.series,
      cell: (r) => <span className="font-medium">{r.series}</span>,
    },
    {
      id: "section",
      header: "Section",
      cell: (r) => <span className="font-mono text-xs">{r.sectionCode}</span>,
    },
    { id: "name", header: "Name", cell: (r) => r.name || "—", flex: 2 },
    {
      id: "status",
      header: "Status",
      cell: (r) => (
        <Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status.toUpperCase()}</Badge>
      ),
    },
    {
      id: "created",
      header: "Created",
      cell: (r) => format(new Date(r.createdAt), "MMM d, yyyy"),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Can
          do="die.update"
          fallback={
            <Link to="/dies/$id" params={{ id: r.id }}>
              <Button variant="ghost" size="sm">
                View
              </Button>
            </Link>
          }
        >
          <Link to="/dies/$id" params={{ id: r.id }}>
            <Button variant="ghost" size="sm">
              Edit
            </Button>
          </Link>
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dies"
        description="Manage your die inventory."
        actions={
          <>
            <Can do="die.import">
              <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
                Import CSV / JSON
              </Button>
            </Can>
            <Can do="die.create">
              <Link to="/dies/$id" params={{ id: "new" }}>
                <Button>Add Die</Button>
              </Link>
            </Can>
          </>
        }
      />

      <Toolbar>
        <Input
          placeholder="Search by name, series, section…"
          value={search}
          onChangeText={setSearch}
          className="max-w-[360px]"
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as DieRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 font-mono text-lg font-semibold text-foreground">{r.series}</p>
                <p className="m-0 text-sm text-muted-foreground">{r.name || "Unnamed die"}</p>
              </div>
              <Badge tone={r.status === "active" ? "success" : "neutral"}>{r.status.toUpperCase()}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Section</p>
                <p className="m-0 font-mono text-foreground">{r.sectionCode}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Created</p>
                <p className="m-0 text-foreground">{format(new Date(r.createdAt), "MMM d, yyyy")}</p>
              </div>
            </div>
            <div className="mt-auto flex justify-end">
              <Can
                do="die.update"
                fallback={
                  <Link to="/dies/$id" params={{ id: r.id }}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                }
              >
                <Link to="/dies/$id" params={{ id: r.id }}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
              </Can>
            </div>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No dies yet"
            description="Add your first die or import the catalog from CSV / JSON."
            actions={
              <Can do="die.create">
                <Link to="/dies/$id" params={{ id: "new" }}>
                  <Button>Add die</Button>
                </Link>
              </Can>
            }
          />
        }
      />

      {isImportModalOpen && (
        <ImportDiesModal
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={() => {
            setIsImportModalOpen(false);
            refetch();
          }}
        />
      )}
    </div>
  );
}
