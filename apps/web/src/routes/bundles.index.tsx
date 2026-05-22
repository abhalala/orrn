import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { requireCompanyMe } from "@/lib/route-guards";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

type StatusFilter = BundleStatus | "all";

export const Route = createFileRoute("/bundles/")({
  component: BundlesListComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as StatusFilter | undefined) ?? "all",
    dieId: (search.dieId as string | undefined) ?? undefined,
    groupId: (search.groupId as string | undefined) ?? undefined,
  }),
  beforeLoad: requireCompanyMe,
});

function statusBadgeClass(status: BundleStatus): string {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-800";
    case "reserved":
      return "bg-amber-100 text-amber-800";
    case "dispatched":
      return "bg-sky-100 text-sky-800";
    case "void":
      return "bg-zinc-200 text-zinc-700";
  }
}

function BundlesListComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const [serialSearch, setSerialSearch] = useState("");

  const status: StatusFilter = search.status ?? "all";

  const { data, isLoading } = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      search: serialSearch || undefined,
      status: status === "all" ? undefined : status,
      dieId: search.dieId,
      groupId: search.groupId,
      limit: 100,
      offset: 0,
    }),
  });

  const items = data?.items ?? [];

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Bundles</h1>
          <p className="text-muted-foreground">
            All bundles across receipts ({data?.total ?? 0} total)
          </p>
        </div>
        <div className="flex space-x-2">
          <Link to="/receipts">
            <Button variant="outline">View Receipts</Button>
          </Link>
          <Link to="/receipts/new">
            <Button>New Production Receipt</Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Input
          placeholder="Search by serial..."
          value={serialSearch}
          onChange={(e) => setSerialSearch(e.target.value)}
          className="max-w-sm"
        />
        <div className="flex items-center gap-1">
          {(["all", ...bundleStatuses] as const).map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => navigate({ search: (prev) => ({ ...prev, status: s }) })}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Button>
          ))}
        </div>
        {(search.dieId || search.groupId) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              navigate({ search: { status, dieId: undefined, groupId: undefined } })
            }
          >
            Clear filters
          </Button>
        )}
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Serial</th>
              <th className="px-4 py-3 font-medium">Die</th>
              <th className="px-4 py-3 font-medium">Receipt</th>
              <th className="px-4 py-3 font-medium text-right">Qty</th>
              <th className="px-4 py-3 font-medium text-right">Weight (g)</th>
              <th className="px-4 py-3 font-medium text-right">Length (mm)</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {isLoading ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                  No bundles found.
                </td>
              </tr>
            ) : (
              items.map((b) => (
                <tr key={b.id} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      to="/bundles/$id"
                      params={{ id: b.id }}
                      className="hover:underline"
                    >
                      {b.serial}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {b.dieSeries} / {b.dieSectionCode}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      to="/receipts/$id"
                      params={{ id: b.groupId }}
                      className="hover:underline"
                    >
                      {b.groupCode}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">{b.quantity}</td>
                  <td className="px-4 py-3 text-right">{b.weightG}</td>
                  <td className="px-4 py-3 text-right">{b.lengthMm}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded ${statusBadgeClass(b.status)}`}
                    >
                      {b.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {format(new Date(b.createdAt), "MMM d, yyyy")}
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
