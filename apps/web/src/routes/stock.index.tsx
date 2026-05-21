import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/stock/")({
  component: StockComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as BundleStatus | undefined) ?? "available",
  }),
});

function StockComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status: BundleStatus = search.status ?? "available";

  const { data, isLoading } = useQuery({
    ...trpc.bundle.stockSummary.queryOptions({ status }),
  });

  const items = data?.items ?? [];
  const totals = data?.totals ?? {
    bundleCount: 0,
    totalQuantity: 0,
    totalWeightG: 0,
    totalLengthMm: 0,
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Stock</h1>
          <p className="text-muted-foreground">Inventory totals aggregated by die.</p>
        </div>
        <div className="flex items-center gap-1">
          {bundleStatuses.map((s) => (
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

      <div className="grid grid-cols-4 gap-4">
        <SummaryCard label="Bundles" value={Number(totals.bundleCount).toString()} />
        <SummaryCard label="Total Quantity" value={Number(totals.totalQuantity).toString()} />
        <SummaryCard label="Total Weight (g)" value={Number(totals.totalWeightG).toLocaleString()} />
        <SummaryCard label="Total Length (mm)" value={Number(totals.totalLengthMm).toLocaleString()} />
      </div>

      <div className="border rounded-md bg-card overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Die</th>
              <th className="px-4 py-3 font-medium">Section</th>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium text-right">Bundles</th>
              <th className="px-4 py-3 font-medium text-right">Quantity</th>
              <th className="px-4 py-3 font-medium text-right">Weight (g)</th>
              <th className="px-4 py-3 font-medium text-right">Length (mm)</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
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
                  No {status} stock.
                </td>
              </tr>
            ) : (
              items.map((row) => (
                <tr key={row.dieId} className="hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{row.dieSeries}</td>
                  <td className="px-4 py-3">{row.dieSectionCode}</td>
                  <td className="px-4 py-3">{row.dieName || "—"}</td>
                  <td className="px-4 py-3 text-right">{Number(row.bundleCount)}</td>
                  <td className="px-4 py-3 text-right">{Number(row.totalQuantity)}</td>
                  <td className="px-4 py-3 text-right">{Number(row.totalWeightG)}</td>
                  <td className="px-4 py-3 text-right">{Number(row.totalLengthMm)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to="/bundles"
                      search={{ status, dieId: row.dieId, groupId: undefined }}
                    >
                      <Button variant="ghost" size="sm">
                        View bundles
                      </Button>
                    </Link>
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card border rounded-lg p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}
