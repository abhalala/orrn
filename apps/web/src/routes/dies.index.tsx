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

import { Can } from "@/components/can";
import { ImportDiesModal } from "@/components/import-dies-modal";
import { requireCompanyMe } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dies/")({
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
          maxWidth={360}
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as DieRow[]}
        rowKey={(r) => r.id}
        columns={columns}
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
