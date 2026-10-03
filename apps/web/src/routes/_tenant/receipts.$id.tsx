import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Fact, FactList } from "@orrn/ui/components/fact-list";
import { ListCard, stretchedLink } from "@orrn/ui/components/list-card";
import { Truncate } from "@orrn/ui/components/truncate";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";

import { Can } from "@/shared/components/can";
import { BundlePrintButton } from "@/shared/components/bundle-print-button";
import { requireCompanyMe } from "@/shared/lib/guards";
import { useLengthUnit } from "@/shared/lib/length";
import { trpc } from "@/shared/utils/trpc";
import { formatKg, formatKgTotal, kgValue } from "@/shared/lib/weight";

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
    return <EmptyState title="Packing session not found" description="It may have been removed. Go back to Packing to find it." />;
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
    { id: "qty", header: "Pieces", align: "right", cell: (b) => b.quantity },
    { id: "weight", header: "Weight (kg)", align: "right", cell: (b) => kgValue(b.weightG) },
    { id: "length", header: `Length (${lu.label})`, align: "right", cell: (b) => lu.formatLength(b.lengthMm) },
    {
      id: "po",
      header: "PO",
      cell: (b) => b.poNumber || group.purchaseOrderRef || "None",
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
        eyebrow="Packing"
        title={group.code}
        description="Packing session from one press run. Print labels before moving bundles into dispatch."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/receipts" })}>
            Back to list
          </Button>
        }
      />

      <Card>
        <FactList>
          <Fact label="Die" wide>
            {die ? (
              <>
                <span className="font-mono font-medium">
                  {die.series} / {die.sectionCode}
                </span>
                {die.name ? <Truncate lines={2} className="text-sm text-muted-foreground">{die.name}</Truncate> : null}
              </>
            ) : (
              "Not set"
            )}
          </Fact>
          <Fact label="Unit">{group.unit}</Fact>
          <Fact label="Session PO" truncate>
            {group.purchaseOrderRef || "None"}
          </Fact>
          <Fact label="Created">{format(new Date(group.createdAt), "PP p")}</Fact>
          <Fact label="Totals" wide>
            <span className="tabular-nums">
              {bundles.length} bundles, {totalQuantity.toLocaleString()} pcs, {formatKgTotal(totalWeightG)},{" "}
              {lu.formatLength(totalLengthMm)}
            </span>
          </Fact>
          <Fact label="Notes" wide>
            {group.notes || "None"}
          </Fact>
        </FactList>
      </Card>

      <Card>
        <CardHeader className="flex min-w-0 flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="min-w-0">Bundles and labels</CardTitle>
          <Button asChild variant="outline" size="sm">
            <Link to="/bundles" search={{ status: "all", groupId: group.id, dieId: undefined }}>
              Open in bundle list
            </Link>
          </Button>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={bundles as BundleRow[]}
            rowKey={(b) => b.id}
            columns={columns}
            renderCard={(b) => (
              <ListCard
                mono
                className="bg-background"
                title={
                  <Link to="/bundles/$id" params={{ id: b.id }} className={stretchedLink}>
                    {b.serial}
                  </Link>
                }
                status={<StatusBadge kind="bundle" value={b.status} size="sm" />}
                facts={[
                  { label: "Pieces", value: b.quantity.toLocaleString() },
                  { label: "Weight", value: formatKg(b.weightG) },
                  { label: "Length", value: lu.formatLength(b.lengthMm) },
                ]}
                footer={
                  <>
                    <span className="min-w-0 truncate" title={b.poNumber || group.purchaseOrderRef || undefined}>
                      PO: {b.poNumber || group.purchaseOrderRef || "None"}
                    </span>
                    <Can do="spool.create_jobs">
                      <BundlePrintButton bundleId={b.id} label="Print label" />
                    </Can>
                  </>
                }
              />
            )}
            emptyState={
              <EmptyState
                title="No bundles"
                description="This packing session has no bundles yet."
              />
            }
          />
        </CardContent>
      </Card>
    </div>
  );
}
