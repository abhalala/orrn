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
    { id: "email", header: "Email", cell: (r) => r.email || "Not set", flex: 2 },
    { id: "phone", header: "Phone", cell: (r) => r.phone || "Not set" },
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
              <Button asChild>
                <Link to="/customers/$id" params={{ id: "new" }}>
                  Add customer
                </Link>
              </Button>
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
          aria-label="Search customers"
          className="sm:max-w-80"
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as CustomerRow[]}
        rowKey={(r) => r.id}
        columns={columns}
        renderCard={(r) => (
          <ListCard
            title={
              <Link to="/customers/$id" params={{ id: r.id }} className={stretchedLink}>
                {r.name}
              </Link>
            }
            titleText={r.name}
            subtitle={`Customer since ${format(new Date(r.createdAt), "MMM d, yyyy")}`}
            facts={[
              { label: "Email", value: r.email || "Not set" },
              { label: "Phone", value: r.phone || "Not set" },
            ]}
            className="[&_dl]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
          />
        )}
        isLoading={isLoading}
        emptyState={
          <EmptyState
            title="No customers yet"
            description="Add your first customer or import a CSV to get started."
            actions={
              <Can do="customer.create">
                <Button asChild>
                  <Link to="/customers/$id" params={{ id: "new" }}>
                    Add customer
                  </Link>
                </Button>
              </Can>
            }
          />
        }
      />
    </div>
  );
}
