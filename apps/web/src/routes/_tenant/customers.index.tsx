import { Button } from "@orrn/ui/components/button";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { format } from "date-fns";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, refetch } = useQuery({
    ...trpc.customer.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  const importMutation = useMutation({
    ...trpc.customer.importCsv.mutationOptions(),
    onSuccess: (res) => {
      toast.success(`Imported ${res.count} customers successfully`);
      refetch();
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to import customers");
    },
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const Papa = (await import("papaparse")).default;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData = results.data
          .map((row: any) => ({
            name: row.name || row.Name,
            email: row.email || row.Email || "",
            phone: row.phone || row.Phone || "",
            taxId: row.taxId || row["Tax ID"] || "",
            notes: row.notes || row.Notes || "",
          }))
          .filter((r) => !!r.name);

        if (parsedData.length === 0) {
          toast.error("No valid rows found. Ensure you have a 'name' column.");
          return;
        }

        importMutation.mutate(parsedData);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      error: (error) => {
        toast.error(`CSV Parsing error: ${error.message}`);
      },
    });
  };

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
            <input
              type="file"
              accept=".csv"
              className="hidden"
              ref={fileInputRef}
              onChange={handleFileUpload}
            />
            <Can do="customer.import">
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending ? "Importing…" : "Import CSV"}
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

      <Toolbar>
        <Input
          placeholder="Search customers…"
          value={search}
          onChangeText={setSearch}
          maxWidth={320}
        />
      </Toolbar>

      <DataTable
        rows={(data?.items ?? []) as CustomerRow[]}
        rowKey={(r) => r.id}
        columns={columns}
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
