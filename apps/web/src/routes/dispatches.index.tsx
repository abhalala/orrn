import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];
type StatusFilter = DispatchStatus | "all";

export const Route = createFileRoute("/dispatches/")({
  component: DispatchesListComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
  }),
  beforeLoad: requireCompanyMe,
});

function statusBadgeClass(status: DispatchStatus | string): string {
  switch (status) {
    case "draft":
      return "bg-zinc-200 text-zinc-700";
    case "reserved":
      return "bg-amber-100 text-amber-800";
    case "completed":
      return "bg-emerald-100 text-emerald-800";
    case "cancelled":
      return "bg-rose-100 text-rose-800";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

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

  const items = data?.items ?? [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Dispatches</h1>
          <p className="text-muted-foreground">
            Outbound shipments and reservations ({data?.total ?? 0} total)
          </p>
        </div>
        <Can do="dispatch.create">
          <Link to="/dispatches/new">
            <Button>New Dispatch</Button>
          </Link>
        </Can>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search by code or notes..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-1">
          {(["all", ...dispatchStatuses] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => navigate({ search: { status: s } })}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium text-right">Items</th>
              <th className="px-4 py-3 font-medium text-right">Weight (g)</th>
              <th className="px-4 py-3 font-medium">Ship Date</th>
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
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No dispatches yet.
                </td>
              </tr>
            ) : (
              items.map((d) => (
                <tr key={d.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link to="/dispatches/$id" params={{ id: d.id }} className="hover:underline">
                      {d.code}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{d.customerName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-1 rounded ${statusBadgeClass(d.status)}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">{Number(d.itemCount)}</td>
                  <td className="px-4 py-3 text-right">{Number(d.totalWeightG)}</td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {d.shipDate ? format(new Date(d.shipDate), "MMM d, yyyy") : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {format(new Date(d.createdAt), "MMM d, yyyy")}
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
