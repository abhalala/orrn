import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";

export const Route = createFileRoute("/receipts/")({
  component: ReceiptsListComponent,
});

function ReceiptsListComponent() {
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listGroups.queryOptions({ search, limit: 50, offset: 0 }),
  });

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Receipts</h1>
          <p className="text-muted-foreground">
            Production receipts (bundle groups) — {data?.total ?? 0} total
          </p>
        </div>
        <Link to="/receipts/new">
          <Button>New Production Receipt</Button>
        </Link>
      </div>

      <div className="flex items-center space-x-2">
        <Input
          placeholder="Search by receipt code or PO ref..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Die</th>
              <th className="px-4 py-3 font-medium">Unit</th>
              <th className="px-4 py-3 font-medium">PO Ref</th>
              <th className="px-4 py-3 font-medium text-right">Bundles</th>
              <th className="px-4 py-3 font-medium text-right">Total Weight (g)</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : !data?.items?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No receipts yet. Create your first production receipt to get started.
                </td>
              </tr>
            ) : (
              data.items.map((g) => (
                <tr key={g.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link to="/receipts/$id" params={{ id: g.id }} className="hover:underline">
                      {g.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {g.dieSeries} / {g.dieSectionCode}
                  </td>
                  <td className="px-4 py-3">{g.unit}</td>
                  <td className="px-4 py-3">{g.purchaseOrderRef || "—"}</td>
                  <td className="px-4 py-3 text-right">{Number(g.bundleCount)}</td>
                  <td className="px-4 py-3 text-right">{Number(g.totalWeightG)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {format(new Date(g.createdAt), "MMM d, yyyy")}
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
