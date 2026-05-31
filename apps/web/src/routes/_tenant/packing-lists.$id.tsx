import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { requireCompanyMe } from "@/shared/lib/guards";
import type { PLSnapshot } from "@/shared/lib/packingListPdf";

export const Route = createFileRoute("/_tenant/packing-lists/$id")({
  component: PackingListDetailComponent,
  beforeLoad: requireCompanyMe,
});

type SnapshotItem = PLSnapshot["items"][number];

function PackingListDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);
  const [xlsxPending, setXlsxPending] = useState(false);
  const lu = useLengthUnit();

  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.get.queryOptions({ id }),
  });

  const regenMutation = useMutation({
    ...trpc.packingList.regenerate.mutationOptions(),
    onSuccess: (newPl: any) => {
      toast.success("Packing list regenerated");
      queryClient.invalidateQueries({ queryKey: trpc.packingList.get.queryKey({ id }) });
      if (newPl.id !== id) {
        navigate({ to: "/packing-lists/$id", params: { id: newPl.id } });
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to regenerate"),
  });

  const columns = useMemo((): DataTableColumn<SnapshotItem & { index: number }>[] => {
    return [
      { id: "index", header: "#", flex: 0.3, cell: (row) => row.index },
      { id: "serial", header: "Serial", flex: 1.2, cell: (row) => row.bundleSerial },
      {
        id: "die",
        header: "Die",
        flex: 1,
        cell: (row) => `${row.die.series} / ${row.die.sectionCode}`,
      },
      { id: "group", header: "Group", flex: 0.8, cell: (row) => row.groupId || "—" },
      { id: "qty", header: "Qty", flex: 0.5, align: "right", cell: (row) => row.quantity },
      {
        id: "weight",
        header: "Weight (kg)",
        flex: 0.7,
        align: "right",
        cell: (row) => (row.weightG / 1000).toFixed(3),
      },
      {
        id: "length",
        header: `Length (${lu.label})`,
        flex: 0.7,
        align: "right",
        cell: (row) => lu.formatLength(row.lengthMm),
      },
    ];
  }, [lu]);

  if (isLoading) {
    return (
      <div className="p-8">
        <EmptyState title="Loading packing list…" />
      </div>
    );
  }
  if (!pl) {
    return (
      <div className="p-8">
        <EmptyState title="Packing list not found" />
      </div>
    );
  }

  const snap = pl.snapshot as unknown as PLSnapshot;
  const cust = snap.dispatch.customer;
  const tableRows = snap.items.map((item, index) => ({ ...item, index: index + 1 }));

  async function handlePdf() {
    setPdfPending(true);
    try {
      const { downloadPackingListPdf } = await import("@/shared/lib/packingListPdf");
      await downloadPackingListPdf(snap, pl!.code, lu.unit);
    } catch {
      toast.error("PDF generation failed");
    } finally {
      setPdfPending(false);
    }
  }

  async function handleXlsx() {
    setXlsxPending(true);
    try {
      const { downloadPackingListXlsx } = await import("@/shared/lib/packingListXlsx");
      await downloadPackingListXlsx(snap, pl!.code, lu.unit);
    } catch {
      toast.error("Excel export failed");
    } finally {
      setXlsxPending(false);
    }
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Packing lists"
        title={pl.code}
        description={
          <>
            Dispatch{" "}
            <Link
              to="/dispatches/$id"
              params={{ id: pl.dispatchId }}
              className="text-primary hover:underline font-mono"
            >
              {snap.dispatch.code}
            </Link>
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => navigate({ to: "/dispatches/$id", params: { id: pl.dispatchId } })}
          >
            Back to dispatch
          </Button>
        }
      />

      <Card>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-6 text-sm">
          <div>
            <Label className="text-xs text-muted-foreground">Customer</Label>
            <p className="font-medium">{cust.name}</p>
            {cust.phone ? <p className="text-muted-foreground">{cust.phone}</p> : null}
            {cust.email ? <p className="text-muted-foreground">{cust.email}</p> : null}
            {cust.taxId ? <p className="text-muted-foreground">Tax ID: {cust.taxId}</p> : null}
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Ship date</Label>
            <p>{snap.dispatch.shipDate ? format(new Date(snap.dispatch.shipDate), "PP") : "—"}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Dispatch</Label>
            <p className="font-mono">{snap.dispatch.code}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Generated</Label>
            <p>{format(new Date(snap.generatedAt), "PP p")}</p>
          </div>
          {snap.dispatch.notes ? (
            <div className="md:col-span-2">
              <Label className="text-xs text-muted-foreground">Notes</Label>
              <p>{snap.dispatch.notes}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Bundles", value: snap.totals.totalBundles },
          { label: "Total qty", value: snap.totals.totalQuantity },
          { label: "Total weight", value: `${snap.totals.totalWeightKg} kg` },
          { label: "Total length", value: lu.formatLength(snap.totals.totalLengthM * 1000) },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardContent className="pt-6 text-center">
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-2xl font-bold font-mono">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={handlePdf} disabled={pdfPending} variant="outline">
          {pdfPending ? "Generating…" : "Download PDF"}
        </Button>
        <Button onClick={handleXlsx} disabled={xlsxPending} variant="outline">
          {xlsxPending ? "Exporting…" : "Download Excel"}
        </Button>
        <Can do="packingList.regenerate">
          <Button
            variant="ghost"
            disabled={regenMutation.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Regenerate packing list? Current PDF data will be overwritten with live dispatch data.",
                )
              ) {
                regenMutation.mutate({ id: pl.id });
              }
            }}
          >
            {regenMutation.isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        </Can>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Items ({snap.items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={tableRows}
            rowKey={(row) => `${row.bundleSerial}-${row.index}`}
            emptyState={<EmptyState title="No items in snapshot" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
