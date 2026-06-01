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
import { ImportCustomersModal } from "@/shared/components/import-customers-modal";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/customers/")({
  component: CustomersListComponent,
  beforeLoad: requireCompanyMe,
});

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  createdAt: string | number | Date;
};

function CustomersListComponent() {
  const [search, setSearch] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    ...trpc.customer.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  const columns: DataTableColumn<CustomerRow>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      sortValue: (r) => r.name,
      cell: (r) => <span className="font-medium">{r.name}</span>,
      flex: 2,
    },
    { id: "email", header: "Email", cell: (r) => r.email || "—", flex: 2 },
    { id: "phone", header: "Phone", cell: (r) => r.phone || "—" },
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
          do="customer.update"
          fallback={
            <Link to="/customers/$id" params={{ id: r.id }}>
              <Button variant="ghost" size="sm">
                View
              </Button>
            </Link>
          }
        >
          <Link to="/customers/$id" params={{ id: r.id }}>
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
        title="Customers"
        description="Manage your customer relationships."
        actions={
          <>
            <Can do="customer.import">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                Import CSV
              </Button>
            </Can>
            <Can do="customer.create">
              <Link to="/customers/$id" params={{ id: "new" }}>
                <Button>Add Customer</Button>
              </Link>
            </Can>
          </>
        }
      />

      {importOpen ? (
        <ImportCustomersModal
          onClose={() => setImportOpen(false)}
          onSuccess={() => {
            setImportOpen(false);
            refetch();
          }}
        />
      ) : null}

      <Toolbar>
        <Input
          placeholder="Search customers…"
          value={search}
          onChangeText={setSearch}
          className="max-w-80"
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as CustomerRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 truncate text-base font-semibold text-foreground">{r.name}</p>
                <p className="m-0 text-xs text-muted-foreground">
                  Customer since {format(new Date(r.createdAt), "MMM d, yyyy")}
                </p>
              </div>
              <Can
                do="customer.update"
                fallback={
                  <Link to="/customers/$id" params={{ id: r.id }}>
                    <Button variant="outline" size="sm">View</Button>
                  </Link>
                }
              >
                <Link to="/customers/$id" params={{ id: r.id }}>
                  <Button variant="outline" size="sm">Edit</Button>
                </Link>
              </Can>
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="min-w-0">
                <p className="m-0 text-xs font-medium text-muted-foreground">Email</p>
                <p className="m-0 truncate text-foreground">{r.email || "—"}</p>
              </div>
              <div className="min-w-0">
                <p className="m-0 text-xs font-medium text-muted-foreground">Phone</p>
                <p className="m-0 truncate text-foreground">{r.phone || "—"}</p>
              </div>
            </div>
          </div>
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No customers yet"
            description="Add your first customer or import a CSV to get started."
            actions={
              <Can do="customer.create">
                <Link to="/customers/$id" params={{ id: "new" }}>
                  <Button>Add customer</Button>
                </Link>
              </Can>
            }
          />
        }
      />
    </div>
  );
}
