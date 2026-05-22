import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { trpc } from "@/utils/trpc";
import { Button } from "@orrn/ui/components/button";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { Can } from "@/components/can";
import { requireCompanyMe } from "@/lib/route-guards";
import type { PLSnapshot } from "@/lib/packingListPdf";

const dispatchStatuses = ["draft", "reserved", "completed", "cancelled"] as const;
type DispatchStatus = (typeof dispatchStatuses)[number];

export const Route = createFileRoute("/dispatches/$id")({
  component: DispatchDetailComponent,
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

function DispatchDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serialQuery, setSerialQuery] = useState("");
  const [bulkSerials, setBulkSerials] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.dispatch.getDispatch.queryOptions({ id }),
  });

  const availableQuery = useQuery({
    ...trpc.bundle.listBundles.queryOptions({
      search: serialQuery || undefined,
      status: "available",
      limit: 20,
      offset: 0,
    }),
    enabled: serialQuery.trim().length > 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id }) });
    queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
    queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
  };

  const addMutation = useMutation({
    ...trpc.dispatch.addBundle.mutationOptions(),
    onSuccess: () => {
      toast.success("Bundle added");
      setSerialQuery("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to add bundle"),
  });

  const bulkMutation = useMutation({
    ...trpc.dispatch.addBundlesBySerial.mutationOptions(),
    onSuccess: (res: any) => {
      toast.success(`Added ${res.added} bundle(s)`);
      setBulkSerials("");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to add bundles"),
  });

  const removeMutation = useMutation({
    ...trpc.dispatch.removeBundle.mutationOptions(),
    onSuccess: () => {
      toast.success("Bundle removed");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to remove bundle"),
  });

  const reserveMutation = useMutation({
    ...trpc.dispatch.reserve.mutationOptions(),
    onSuccess: () => {
      toast.success("Dispatch reserved");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to reserve"),
  });

  const unreserveMutation = useMutation({
    ...trpc.dispatch.unreserve.mutationOptions(),
    onSuccess: () => {
      toast.success("Dispatch unreserved");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to unreserve"),
  });

  const completeMutation = useMutation({
    ...trpc.dispatch.complete.mutationOptions(),
    onSuccess: () => {
      toast.success("Dispatch completed");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to complete"),
  });

  const cancelMutation = useMutation({
    ...trpc.dispatch.cancel.mutationOptions(),
    onSuccess: () => {
      toast.success("Dispatch cancelled");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to cancel"),
  });

  const deleteMutation = useMutation({
    ...trpc.dispatch.softDelete.mutationOptions(),
    onSuccess: () => {
      toast.success("Dispatch deleted");
      invalidate();
      navigate({ to: "/dispatches", search: { status: "all" } });
    },
    onError: (e: any) => toast.error(e.message || "Failed to delete"),
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!data) return <div className="p-8">Dispatch not found.</div>;

  const { dispatch: d, customer: c, items, events } = data;
  const canEdit = d.status === "draft";
  const canAddOrRemove = d.status === "draft" || d.status === "reserved";
  const canReserve = d.status === "draft" && items.length > 0;
  const canUnreserve = d.status === "reserved";
  const canComplete = d.status === "reserved" && items.length > 0;
  const canCancel = d.status === "draft" || d.status === "reserved";
  const canDelete = d.status === "draft" || d.status === "cancelled";

  const totalQty = items.reduce((s, it) => s + it.quantity, 0);
  const totalWeight = items.reduce((s, it) => s + it.weightG, 0);

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold font-mono">{d.code}</h1>
          <p className="text-muted-foreground">Dispatch</p>
        </div>
        <Button variant="outline" onClick={() => navigate({ to: "/dispatches", search: { status: "all" } })}>
          Back
        </Button>
      </div>

      <div className="bg-card border rounded-lg p-6 grid grid-cols-2 gap-4 text-sm">
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <p className="mt-1">
            <span className={`text-sm font-medium px-3 py-1 rounded ${statusBadgeClass(d.status)}`}>
              {d.status}
            </span>
          </p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Customer</Label>
          <p className="font-medium">{c?.name ?? "(deleted)"}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Ship Date</Label>
          <p>{d.shipDate ? format(new Date(d.shipDate), "PP") : "—"}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">Created</Label>
          <p>{format(new Date(d.createdAt), "PP p")}</p>
        </div>
        {d.completedAt && (
          <div>
            <Label className="text-xs text-muted-foreground">Completed</Label>
            <p>{format(new Date(d.completedAt), "PP p")}</p>
          </div>
        )}
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">Notes</Label>
          <p>{d.notes || "—"}</p>
        </div>
        <div className="col-span-2">
          <Label className="text-xs text-muted-foreground">Totals</Label>
          <p>
            {items.length} bundle(s) · {totalQty} qty · {totalWeight} g
          </p>
        </div>
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-3">
        <h2 className="text-lg font-semibold">Actions</h2>
        <div className="flex flex-wrap gap-2">
          <Can do="dispatch.reserve">
            <Button
              disabled={!canReserve || reserveMutation.isPending}
              onClick={() => reserveMutation.mutate({ id })}
            >
              Reserve
            </Button>
            <Button
              variant="outline"
              disabled={!canUnreserve || unreserveMutation.isPending}
              onClick={() => unreserveMutation.mutate({ id })}
            >
              Unreserve
            </Button>
          </Can>
          <Can do="dispatch.complete">
            <Button
              disabled={!canComplete || completeMutation.isPending}
              onClick={() => {
                if (window.confirm("Complete this dispatch? Bundles will be marked as dispatched.")) {
                  completeMutation.mutate({ id });
                }
              }}
            >
              Complete
            </Button>
          </Can>
          <Can do="dispatch.cancel">
            <Button
              variant="destructive"
              disabled={!canCancel || cancelMutation.isPending}
              onClick={() => {
                if (window.confirm("Cancel this dispatch?")) {
                  cancelMutation.mutate({ id, reason: null });
                }
              }}
            >
              Cancel
            </Button>
          </Can>
          {canDelete && (
            <Can do="dispatch.delete">
              <Button
                variant="ghost"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm("Delete this dispatch permanently from active views?")) {
                    deleteMutation.mutate({ id });
                  }
                }}
              >
                Delete
              </Button>
            </Can>
          )}
        </div>
      </div>

      {canAddOrRemove && (
        <Can do="dispatch.addBundle">
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h2 className="text-lg font-semibold">Add bundles</h2>
          <div className="space-y-2">
            <Label htmlFor="serial-search">Search available bundles by serial</Label>
            <Input
              id="serial-search"
              value={serialQuery}
              onChange={(e) => setSerialQuery(e.target.value)}
              placeholder="Type at least 1 character..."
            />
            {serialQuery && availableQuery.data && (
              <div className="border rounded-md mt-2 max-h-64 overflow-auto">
                {availableQuery.data.items.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">No available bundles match.</p>
                ) : (
                  <ul className="divide-y">
                    {availableQuery.data.items.map((b) => (
                      <li key={b.id} className="flex items-center justify-between p-3 text-sm">
                        <div>
                          <p className="font-mono">{b.serial}</p>
                          <p className="text-xs text-muted-foreground">
                            {b.dieSeries} / {b.dieSectionCode} · qty {b.quantity} · {b.weightG}g
                          </p>
                        </div>
                        <Button
                          size="sm"
                          disabled={addMutation.isPending}
                          onClick={() => addMutation.mutate({ id, bundleId: b.id })}
                        >
                          Add
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="bulk-serials">Paste serials (one per line)</Label>
            <textarea
              id="bulk-serials"
              rows={4}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              value={bulkSerials}
              onChange={(e) => setBulkSerials(e.target.value)}
              placeholder="BG-000123-B001&#10;BG-000123-B002"
            />
            <Button
              variant="outline"
              size="sm"
              disabled={bulkMutation.isPending || !bulkSerials.trim()}
              onClick={() => {
                const serials = bulkSerials
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean);
                if (serials.length === 0) {
                  toast.error("No serials provided");
                  return;
                }
                bulkMutation.mutate({ id, serials });
              }}
            >
              {bulkMutation.isPending ? "Adding..." : "Add by serial"}
            </Button>
          </div>
        </div>
        </Can>
      )}

      <div className="bg-card border rounded-lg overflow-hidden">
        <div className="p-4 border-b flex items-center justify-between">
          <h2 className="text-lg font-semibold">Items ({items.length})</h2>
        </div>
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th className="px-4 py-2 font-medium">Serial</th>
              <th className="px-4 py-2 font-medium">Die</th>
              <th className="px-4 py-2 font-medium text-right">Qty</th>
              <th className="px-4 py-2 font-medium text-right">Weight (g)</th>
              <th className="px-4 py-2 font-medium text-right">Length (mm)</th>
              <th className="px-4 py-2 font-medium">Status</th>
              {canAddOrRemove && <th className="px-4 py-2"></th>}
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.length === 0 ? (
              <tr>
                <td colSpan={canAddOrRemove ? 7 : 6} className="px-4 py-8 text-center text-muted-foreground">
                  No bundles in this dispatch yet.
                </td>
              </tr>
            ) : (
              items.map((it) => (
                <tr key={it.itemId}>
                  <td className="px-4 py-2 font-mono text-xs">
                    <Link to="/bundles/$id" params={{ id: it.bundleId }} className="hover:underline">
                      {it.serial}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {it.dieSeries} / {it.dieSectionCode}
                  </td>
                  <td className="px-4 py-2 text-right">{it.quantity}</td>
                  <td className="px-4 py-2 text-right">{it.weightG}</td>
                  <td className="px-4 py-2 text-right">{it.lengthMm}</td>
                  <td className="px-4 py-2 capitalize">{it.status}</td>
                  {canAddOrRemove && (
                    <td className="px-4 py-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate({ id, bundleId: it.bundleId })}
                      >
                        Remove
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Packing list — shown for completed dispatches */}
      {d.status === "completed" && <PackingListSection dispatchId={d.id} />}

      <div className="bg-card border rounded-lg p-6 space-y-3">
        <h2 className="text-lg font-semibold">Activity</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li key={ev.id} className="flex items-start justify-between text-sm border-b last:border-b-0 pb-2 gap-4">
                <div>
                  <p className="font-medium">{ev.action}</p>
                  {ev.meta && Object.keys(ev.meta).length > 0 && (
                    <p className="text-xs text-muted-foreground font-mono">{JSON.stringify(ev.meta)}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {format(new Date(ev.at), "PP p")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packing list section — embedded in dispatch detail for completed dispatches
// ---------------------------------------------------------------------------
function PackingListSection({ dispatchId }: { dispatchId: string }) {
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);
  const [xlsxPending, setXlsxPending] = useState(false);

  const { data: pl, isLoading } = useQuery({
    ...trpc.packingList.byDispatch.queryOptions({ dispatchId }),
  });

  const regenMutation = useMutation({
    ...trpc.packingList.regenerate.mutationOptions(),
    onSuccess: () => {
      toast.success("Packing list regenerated");
      queryClient.invalidateQueries({ queryKey: trpc.packingList.byDispatch.queryKey({ dispatchId }) });
    },
    onError: (e: any) => toast.error(e.message || "Failed to regenerate"),
  });

  async function handlePdf() {
    if (!pl) return;
    setPdfPending(true);
    try {
      const { downloadPackingListPdf } = await import("@/lib/packingListPdf");
      await downloadPackingListPdf(pl.snapshot as unknown as PLSnapshot, pl.code);
    } catch {
      toast.error("PDF generation failed");
    } finally {
      setPdfPending(false);
    }
  }

  async function handleXlsx() {
    if (!pl) return;
    setXlsxPending(true);
    try {
      const { downloadPackingListXlsx } = await import("@/lib/packingListXlsx");
      await downloadPackingListXlsx(pl.snapshot as unknown as PLSnapshot, pl.code);
    } catch {
      toast.error("Excel export failed");
    } finally {
      setXlsxPending(false);
    }
  }

  return (
    <div className="bg-card border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Packing List</h2>
        {pl && (
          <Link
            to="/packing-lists/$id"
            params={{ id: pl.id }}
            className="text-sm text-primary hover:underline font-mono"
          >
            {pl.code}
          </Link>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !pl ? (
        <p className="text-sm text-muted-foreground">No packing list generated yet.</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Generated {format(new Date((pl.snapshot as any).generatedAt as string), "PP p")}
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" onClick={handlePdf} disabled={pdfPending} variant="outline">
              {pdfPending ? "Generating…" : "PDF"}
            </Button>
            <Button size="sm" onClick={handleXlsx} disabled={xlsxPending} variant="outline">
              {xlsxPending ? "Exporting…" : "Excel"}
            </Button>
            <Can do="packingList.regenerate">
              <Button
                size="sm"
                variant="ghost"
                disabled={regenMutation.isPending}
                onClick={() => {
                  if (window.confirm("Regenerate? Snapshot will be rebuilt from live dispatch data.")) {
                    regenMutation.mutate({ id: pl.id });
                  }
                }}
              >
                {regenMutation.isPending ? "Regenerating…" : "Regenerate"}
              </Button>
            </Can>
          </div>
        </>
      )}
    </div>
  );
}
