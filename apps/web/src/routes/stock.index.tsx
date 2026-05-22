import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Tabs } from "@orrn/ui/components/tabs";
import { Toolbar } from "@orrn/ui/components/toolbar";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { requireCompanyMe } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/stock/")({
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
      header: "Length (mm)",
      align: "right",
      cell: (r) => Number(r.totalLengthMm).toLocaleString(),
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
        <SummaryCard label="Total Length (mm)" value={Number(totals.totalLengthMm).toLocaleString()} />
      </div>

      <DataTable
        rows={items}
        rowKey={(r) => r.dieId}
        columns={columns}
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
