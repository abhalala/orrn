import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Label } from "@orrn/ui/components/label";
import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";
import type { PLSnapshot } from "@/lib/packingListPdf";

export const Route = createFileRoute("/packing-lists/$id")({
  component: PackingListDetailComponent,
  beforeLoad: requireCompanyMe,
});

function PackingListDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);
  const [xlsxPending, setXlsxPending] = useState(false);

  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.get.queryOptions({ id }),
  });

  const regenMutation = useMutation({
    ...trpc.packingList.regenerate.mutationOptions(),
    onSuccess: (newPl) => {
      toast.success("Packing list regenerated");
      queryClient.invalidateQueries({ queryKey: trpc.packingList.get.queryKey({ id }) });
      // Navigate to new id if it changed
      if (newPl.id !== id) {
        navigate({ to: "/packing-lists/$id", params: { id: newPl.id } });
      }
    },
    onError: (e: any) => toast.error(e.message || "Failed to regenerate"),
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!pl) return <div className="p-8">Packing list not found.</div>;

  const snap = pl.snapshot as unknown as PLSnapshot;
  const cust = snap.dispatch.customer;

  async function handlePdf() {
    setPdfPending(true);
    try {
      const { downloadPackingListPdf } = await import("@/lib/packingListPdf");
      await downloadPackingListPdf(snap, pl!.code);
    } catch {
      toast.error("PDF generation failed");
    } finally {
      setPdfPending(false);
    }
  }

  async function handleXlsx() {
    setXlsxPending(true);
    try {
      const { downloadPackingListXlsx } = await import("@/lib/packingListXlsx");
      await downloadPackingListXlsx(snap, pl!.code);
    } catch {
      toast.error("Excel export failed");
    } finally {
      setXlsxPending(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold font-mono">{pl.code}</h1>
          <p className="text-muted-foreground">
            Packing List ·{" "}
            <Link
              to="/dispatches/$id"
              params={{ id: pl.dispatchId }}
              className="hover:underline text-primary"
            >
              {snap.dispatch.code}
            </Link>
          </p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/dispatches/$id", params: { id: pl.dispatchId } })}>
          Back to Dispatch
        </Button>
      </div>

      {/* Summary */}
      <div className="bg-card border rounded-lg p-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <Label className="text-xs text-muted-foreground">Customer</Label>
          <p className="font-medium">{cust.name}</p>
          {cust.phone && <p className="text-muted-foreground">{cust.phone}</p>}
          {cust.email && <p className="text-muted-foreground">{cust.email}</p>}
          {cust.taxId && <p className="text-muted-foreground">Tax ID: {cust.taxId}</p>}
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ship Date</Label>
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
        {snap.dispatch.notes && (
          <div className="col-span-2">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <p>{snap.dispatch.notes}</p>
          </div>
        )}
      </div>

      {/* Totals */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Bundles", value: snap.totals.totalBundles },
          { label: "Total Qty", value: snap.totals.totalQuantity },
          { label: "Total Weight", value: `${snap.totals.totalWeightKg} kg` },
          { label: "Total Length", value: `${snap.totals.totalLengthM} m` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-card border rounded-lg p-4 text-center">
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className="text-2xl font-bold font-mono">{value}</p>
          </div>
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-2">
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
              if (window.confirm("Regenerate packing list? Current PDF data will be overwritten with live dispatch data.")) {
                regenMutation.mutate({ id: pl!.id });
              }
            }}
          >
            {regenMutation.isPending ? "Regenerating…" : "Regenerate"}
          </Button>
        </Can>
      </div>

      {/* Items table */}
      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">Items ({snap.items.length})</h2>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">#</th>
              <th className="px-4 py-2 font-medium">Serial</th>
              <th className="px-4 py-2 font-medium">Die</th>
              <th className="px-4 py-2 font-medium">Group</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Weight (kg)</th>
              <th className="px-4 py-2 font-medium text-right">Length (m)</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {snap.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No items in snapshot.
                </td>
              </tr>
            ) : (
              snap.items.map((item, i) => (
                <tr key={i} className={i % 2 === 0 ? "" : "bg-muted/30"}>
                  <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-4 py-2 font-mono text-xs">{item.bundleSerial}</td>
                  <td className="px-4 py-2">{item.die.series} / {item.die.sectionCode}</td>
                  <td className="px-4 py-2 text-muted-foreground">{item.groupId || "—"}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                  <td className="px-4 py-2 text-right">{(item.weightG / 1000).toFixed(3)}</td>
                  <td className="px-4 py-2 text-right">{(item.lengthMm / 1000).toFixed(3)}</td>
                </tr>
              ))
            )}
          </tbody>
          <tfoot className="bg-muted/50 font-medium text-sm">
            <tr>
              <td colSpan={4} className="px-4 py-2">Total</td>
              <td className="px-4 py-2 text-right">{snap.totals.totalQuantity}</td>
              <td className="px-4 py-2 text-right">{snap.totals.totalWeightKg}</td>
              <td className="px-4 py-2 text-right">{snap.totals.totalLengthM}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
