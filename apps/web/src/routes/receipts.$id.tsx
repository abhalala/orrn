import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";

import { requireCompanyMe } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/receipts/$id")({
  component: ReceiptDetailComponent,
  beforeLoad: requireCompanyMe,
});

type BundleRow = {
  id: string;
  serial: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  status: string;
};

function ReceiptDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getGroup.queryOptions({ id }),
  });

  if (isLoading) return <div>Loading…</div>;
  if (!data) {
    return <EmptyState title="Receipt not found" description="This receipt may have been removed." />;
  }

  const { group, die, bundles } = data;
  const totalQuantity = bundles.reduce((s, b) => s + b.quantity, 0);
  const totalWeightG = bundles.reduce((s, b) => s + b.weightG, 0);
  const totalLengthMm = bundles.reduce((s, b) => s + b.lengthMm, 0);

  const columns: DataTableColumn<BundleRow>[] = [
    {
      id: "serial",
      header: "Serial",
      flex: 2,
      cell: (b) => (
        <Link to="/bundles/$id" params={{ id: b.id }} className="font-mono text-xs hover:underline">
          {b.serial}
        </Link>
      ),
    },
    { id: "qty", header: "Qty", align: "right", cell: (b) => b.quantity },
    { id: "weight", header: "Weight (g)", align: "right", cell: (b) => b.weightG },
    { id: "length", header: "Length (mm)", align: "right", cell: (b) => b.lengthMm },
    {
      id: "status",
      header: "Status",
      cell: (b) => <StatusBadge kind="bundle" value={b.status} size="sm" />,
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Receipts"
        title={group.code}
        description="Production receipt and bundles created from intake."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
            Back to list
          </Button>
        }
      />

      <Card>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Die</Label>
              <p className="font-medium">
                {die ? `${die.series} / ${die.sectionCode}${die.name ? ` — ${die.name}` : ""}` : "—"}
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Unit</Label>
              <p>{group.unit}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">PO Reference</Label>
              <p>{group.purchaseOrderRef || "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <p>{group.notes || "—"}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Created</Label>
              <p>{format(new Date(group.createdAt), "PP p")}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Totals</Label>
              <p>
                {bundles.length} bundles · {totalQuantity} qty · {totalWeightG} g · {totalLengthMm} mm
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bundles in this receipt</CardTitle>
          <Link to="/bundles" search={{ status: "all", groupId: group.id, dieId: undefined }}>
            <Button variant="outline" size="sm">
              Open in bundle list
            </Button>
          </Link>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={bundles as BundleRow[]}
            rowKey={(b) => b.id}
            columns={columns}
            emptyState={
              <EmptyState
                title="No bundles"
                description="This receipt has no bundles yet."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
