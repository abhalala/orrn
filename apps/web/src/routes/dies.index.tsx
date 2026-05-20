import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { ImportDiesModal } from "@/components/import-dies-modal";

export const Route = createFileRoute("/dies/")({
  component: DiesListComponent,
});

function DiesListComponent() {
  const [search, setSearch] = useState("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    ...trpc.die.list.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dies</h1>
          <p className="text-muted-foreground">Manage your die inventory.</p>
        </div>
        <div className="flex space-x-2">
          <Button variant="outline" onClick={() => setIsImportModalOpen(true)}>
            Import CSV / JSON
          </Button>
          <Link to="/dies/$id" params={{ id: "new" }}>
            <Button>Add Die</Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <Input 
          placeholder="Search by name, series, section..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="border rounded-md bg-card">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Series</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : data?.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No dies found.
                </td>
              </tr>
            ) : (
              data?.items.map((die) => (
                <tr key={die.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{die.series}</td>
                  <td className="px-4 py-3 font-medium">{die.sectionCode}</td>
                  <td className="px-4 py-3">{die.name || "-"}</td>
                  <td className="px-4 py-3 capitalize">{die.status}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {format(new Date(die.createdAt), "MMM d, yyyy")}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to="/dies/$id" params={{ id: die.id }}>
                      <Button variant="ghost" size="sm">Edit</Button>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      
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
