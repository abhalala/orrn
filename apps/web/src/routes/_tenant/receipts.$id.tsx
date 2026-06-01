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

import { Can } from "@/shared/components/can";
import { BundlePrintButton } from "@/shared/components/bundle-print-button";
import { requireCompanyMe } from "@/shared/lib/guards";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/receipts/$id")({
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
  poNumber?: string | null;
};

function ReceiptDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const lu = useLengthUnit();

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
    { id: "length", header: `Length (${lu.label})`, align: "right", cell: (b) => lu.formatLength(b.lengthMm) },
    {
      id: "po",
      header: "PO",
      cell: (b) => b.poNumber || group.purchaseOrderRef || "—",
    },
    {
      id: "status",
      header: "Status",
      cell: (b) => <StatusBadge kind="bundle" value={b.status} size="sm" />,
    },
    {
      id: "print",
      header: "Print",
      align: "right",
      cell: (b) => (
        <Can do="spool.create_jobs">
          <BundlePrintButton bundleId={b.id} label="Print" />
        </Can>
      ),
    },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Receipts"
        title={group.code}
        description="Bundling session created from production receipt data. Print labels before moving bundles into dispatch."
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
              <Label className="text-xs text-muted-foreground">Session PO</Label>
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
                {bundles.length} bundles · {totalQuantity} qty · {totalWeightG} g · {lu.formatLength(totalLengthMm)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Bundles and labels</CardTitle>
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
            renderCard={(b) => (
              <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link to="/bundles/$id" params={{ id: b.id }} className="font-mono text-sm font-semibold hover:underline">
                    {b.serial}
                  </Link>
                  <StatusBadge kind="bundle" value={b.status} size="sm" />
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Qty</p>
                    <p className="m-0 text-foreground">{b.quantity}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Weight</p>
                    <p className="m-0 text-foreground">{b.weightG.toLocaleString()} g</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Length</p>
                    <p className="m-0 text-foreground">{lu.formatLength(b.lengthMm)}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                  <p className="m-0 text-xs text-muted-foreground">PO: {b.poNumber || group.purchaseOrderRef || "—"}</p>
                  <Can do="spool.create_jobs">
                    <BundlePrintButton bundleId={b.id} label="Print label" />
                  </Can>
                </div>
              </div>
            )}
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
