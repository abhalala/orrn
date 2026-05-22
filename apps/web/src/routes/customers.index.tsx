import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import Papa from "papaparse";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";

export const Route = createFileRoute("/customers/")({
  component: CustomersListComponent,
  beforeLoad: requireCompanyMe,
});

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
    }
  });

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const parsedData = results.data.map((row: any) => ({
          name: row.name || row.Name,
          email: row.email || row.Email || "",
          phone: row.phone || row.Phone || "",
          taxId: row.taxId || row["Tax ID"] || "",
          notes: row.notes || row.Notes || "",
        })).filter(r => !!r.name);

        if (parsedData.length === 0) {
          toast.error("No valid rows found. Ensure you have a 'name' column.");
          return;
        }

        importMutation.mutate(parsedData);
        if (fileInputRef.current) fileInputRef.current.value = "";
      },
      error: (error) => {
        toast.error(`CSV Parsing error: ${error.message}`);
      }
    });
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground">Manage your customer relationships.</p>
        </div>
        <div className="flex space-x-2">
          <input 
            type="file" 
            accept=".csv" 
            className="hidden" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
          />
          <Can do="customer.import">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={importMutation.isPending}>
              {importMutation.isPending ? "Importing..." : "Import CSV"}
            </Button>
          </Can>
          <Can do="customer.create">
            <Link to="/customers/$id" params={{ id: "new" }}>
              <Button>Add Customer</Button>
            </Link>
          </Can>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Input 
          placeholder="Search customers..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="border rounded-md bg-card">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Phone</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : data?.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No customers found.
                </td>
              </tr>
            ) : (
              data?.items.map((customer) => (
                <tr key={customer.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{customer.name}</td>
                  <td className="px-4 py-3">{customer.email || "-"}</td>
                  <td className="px-4 py-3">{customer.phone || "-"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format(new Date(customer.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Can do="customer.update" fallback={
                      <Link to="/customers/$id" params={{ id: customer.id }}>
                        <Button variant="ghost" size="sm">View</Button>
                      </Link>
                    }>
                      <Link to="/customers/$id" params={{ id: customer.id }}>
                        <Button variant="ghost" size="sm">Edit</Button>
                      </Link>
                    </Can>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
