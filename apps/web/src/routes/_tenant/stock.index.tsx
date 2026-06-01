import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { useLengthUnit } from "@/shared/lib/length";
import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/_tenant/stock/")({
  component: StockComponent,
  validateSearch: (search: Record<string, unknown>) => ({
    status: (search.status as BundleStatus | undefined) ?? "available",
  }),
  beforeLoad: requireCompanyMe,
});

type StockRow = {
  dieId: string;
  dieSeries: string;
  dieSectionCode: string;
  dieName: string | null;
  bundleCount: number | string;
  totalQuantity: number | string;
  totalWeightG: number | string;
  totalLengthMm: number | string;
};

function StockComponent() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const status: BundleStatus = search.status ?? "available";
  const lu = useLengthUnit();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.stockSummary.queryOptions({ status }),
  });

  const items = (data?.items ?? []) as StockRow[];
  const totals = data?.totals ?? {
    bundleCount: 0,
    totalQuantity: 0,
    totalWeightG: 0,
    totalLengthMm: 0,
  };

  const columns: DataTableColumn<StockRow>[] = [
    { id: "series", header: "Die", cell: (r) => r.dieSeries, sortable: true, sortValue: (r) => r.dieSeries },
    { id: "section", header: "Section", cell: (r) => r.dieSectionCode },
    { id: "name", header: "Name", cell: (r) => r.dieName || "—", flex: 2 },
    {
      id: "bundles",
      header: "Bundles",
      align: "right",
      cell: (r) => Number(r.bundleCount),
    },
    {
      id: "qty",
      header: "Quantity",
      align: "right",
      cell: (r) => Number(r.totalQuantity).toLocaleString(),
    },
    {
      id: "weight",
      header: "Weight (g)",
      align: "right",
      cell: (r) => Number(r.totalWeightG).toLocaleString(),
    },
    {
      id: "length",
      header: `Length (${lu.label})`,
      align: "right",
      cell: (r) => lu.formatLength(Number(r.totalLengthMm)),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      cell: (r) => (
        <Link to="/bundles" search={{ status, dieId: r.dieId, groupId: undefined }}>
          <Button variant="ghost" size="sm">
            View bundles
          </Button>
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stock"
        description="Inventory totals aggregated by die."
      />

      <Toolbar>
        <Tabs
          value={status}
          onValueChange={(v) => navigate({ search: { status: v as BundleStatus } })}
          items={bundleStatuses.map((s) => ({
            id: s,
            label: s.charAt(0).toUpperCase() + s.slice(1),
          }))}
        />
      </Toolbar>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Bundles" value={Number(totals.bundleCount).toLocaleString()} />
        <SummaryCard label="Total Quantity" value={Number(totals.totalQuantity).toLocaleString()} />
        <SummaryCard label="Total Weight (g)" value={Number(totals.totalWeightG).toLocaleString()} />
        <SummaryCard label={`Total Length (${lu.label})`} value={lu.formatLength(Number(totals.totalLengthMm))} />
      </div>

      <DataTable
        rows={items}
        rowKey={(r) => r.dieId}
        columns={columns}
        renderCard={(r) => (
          <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 font-mono text-lg font-semibold text-foreground">{r.dieSeries}</p>
                <p className="m-0 text-sm text-muted-foreground">{r.dieName || r.dieSectionCode}</p>
              </div>
              <Link to="/bundles" search={{ status, dieId: r.dieId, groupId: undefined }}>
                <Button variant="outline" size="sm">Bundles</Button>
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Section</p>
                <p className="m-0 font-mono text-foreground">{r.dieSectionCode}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Bundles</p>
                <p className="m-0 text-foreground">{Number(r.bundleCount).toLocaleString()}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Quantity</p>
                <p className="m-0 text-foreground">{Number(r.totalQuantity).toLocaleString()}</p>
              </div>
              <div>
                <p className="m-0 text-xs font-medium text-muted-foreground">Weight</p>
                <p className="m-0 text-foreground">{Number(r.totalWeightG).toLocaleString()} g</p>
              </div>
            </div>
            <p className="m-0 border-t border-border pt-3 text-xs text-muted-foreground">
              Total length {lu.formatLength(Number(r.totalLengthMm))}
            </p>
          </div>
        )}
        isLoading={isLoading}
        emptyState={<EmptyState title={`No ${status} stock`} description="Nothing in this bucket yet." />}
      />
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent />
    </Card>
  );
}
