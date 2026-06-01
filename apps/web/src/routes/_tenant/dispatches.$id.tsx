import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";

import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { DataTable, type DataTableColumn } from "@orrn/ui/components/data-table";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Can } from "@/shared/components/can";
import { useLengthUnit } from "@/shared/lib/length";
import { requireCompanyMe } from "@/shared/lib/guards";
import { downloadPackingListPdf, type PLSnapshot } from "@/shared/lib/packingListPdf";
import { downloadPackingListXlsx } from "@/shared/lib/packingListXlsx";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dispatches/$id")({
  component: DispatchDetailComponent,
  beforeLoad: requireCompanyMe,
});

type DispatchItemRow = {
  itemId: string;
  bundleId: string;
  serial: string;
  dieSeries: string;
  dieSectionCode: string;
  quantity: number;
  weightG: number;
  lengthMm: number;
  groupLabel: string | null;
  status: string;
};

function DispatchDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [serialQuery, setSerialQuery] = useState("");
  const [bulkSerials, setBulkSerials] = useState("");
  const [groupLabels, setGroupLabels] = useState<Record<string, string>>({});
  const lu = useLengthUnit();

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

  const groupLabelMutation = useMutation({
    ...trpc.dispatch.setItemGroupLabel.mutationOptions(),
    onSuccess: () => {
      toast.success("Packing group updated");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || "Failed to update packing group"),
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

  if (isLoading) return <div>Loading…</div>;
  if (!data) {
    return <EmptyState title="Dispatch not found" description="This dispatch may have been removed." />;
  }

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

  const itemColumns: DataTableColumn<DispatchItemRow>[] = [
    {
      id: "serial",
      header: "Serial",
      flex: 2,
      cell: (it) => (
        <Link to="/bundles/$id" params={{ id: it.bundleId }} className="font-mono text-xs hover:underline">
          {it.serial}
        </Link>
      ),
    },
    {
      id: "die",
      header: "Die",
      cell: (it) => `${it.dieSeries} / ${it.dieSectionCode}`,
    },
    { id: "group", header: "Group", cell: (it) => it.groupLabel || "—" },
    { id: "qty", header: "Qty", align: "right", cell: (it) => it.quantity },
    { id: "weight", header: "Weight (g)", align: "right", cell: (it) => it.weightG },
    { id: "length", header: `Length (${lu.label})`, align: "right", cell: (it) => lu.formatLength(it.lengthMm) },
    {
      id: "status",
      header: "Status",
      cell: (it) => <StatusBadge kind="bundle" value={it.status} size="sm" />,
    },
    ...(canAddOrRemove
      ? [
          {
            id: "actions",
            header: "",
            align: "right" as const,
            cell: (it: DispatchItemRow) => (
              <div className="flex items-center justify-end gap-2">
                <Input
                  value={groupLabels[it.itemId] ?? it.groupLabel ?? ""}
                  onChange={(e) => setGroupLabels((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
                  placeholder="A"
                  className="h-8 w-16"
                />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={groupLabelMutation.isPending}
                  onClick={() =>
                    groupLabelMutation.mutate({
                      id,
                      bundleId: it.bundleId,
                      groupLabel: groupLabels[it.itemId] ?? it.groupLabel ?? null,
                    })
                  }
                >
                  Group
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate({ id, bundleId: it.bundleId })}
                >
                  Remove
                </Button>
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Dispatches"
        title={d.code}
        description="Dispatch lifecycle, scanned bundles, packing groups, and completion."
        actions={
          <Button variant="outline" onClick={() => navigate({ to: "/dispatches", search: { status: "all" } })}>
            Back to list
          </Button>
        }
      />

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div>
          <Label className="text-xs text-muted-foreground">Status</Label>
          <p className="mt-1">
            <StatusBadge kind="dispatch" value={d.status} />
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
        <div className="sm:col-span-2">
          <Label className="text-xs text-muted-foreground">Totals</Label>
          <p>
            {items.length} bundle(s) · {totalQty} qty · {totalWeight} g
          </p>
        </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>

      {canAddOrRemove && (
        <Can do="dispatch.addBundle">
        <Card>
          <CardHeader>
            <CardTitle>Add bundles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
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
                            {b.dieSeries} / {b.dieSectionCode} · qty {b.quantity} · {b.weightG}g · {lu.formatLength(b.lengthMm)}
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
            <Label htmlFor="bulk-serials">Scan or paste serials / UUIDs (one per line)</Label>
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
          </CardContent>
        </Card>
        </Can>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Items ({items.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            rows={items as DispatchItemRow[]}
            rowKey={(it) => it.itemId}
            columns={itemColumns}
            renderCard={(it) => (
              <div className="flex h-full min-w-0 flex-col gap-4 rounded-lg border border-border bg-background p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/bundles/$id" params={{ id: it.bundleId }} className="font-mono text-sm font-semibold hover:underline">
                      {it.serial}
                    </Link>
                    <p className="m-0 text-xs text-muted-foreground">
                      {it.dieSeries} / {it.dieSectionCode}
                    </p>
                    <p className="m-0 text-xs text-muted-foreground">Packing group {it.groupLabel || "—"}</p>
                  </div>
                  <StatusBadge kind="bundle" value={it.status} size="sm" />
                </div>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Qty</p>
                    <p className="m-0 text-foreground">{it.quantity}</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Weight</p>
                    <p className="m-0 text-foreground">{it.weightG.toLocaleString()} g</p>
                  </div>
                  <div>
                    <p className="m-0 text-xs font-medium text-muted-foreground">Length</p>
                    <p className="m-0 text-foreground">{lu.formatLength(it.lengthMm)}</p>
                  </div>
                </div>
                {canAddOrRemove ? (
                  <div className="flex flex-wrap items-end gap-2 border-t border-border pt-3">
                    <div className="min-w-28 flex-1">
                      <Label htmlFor={`${it.itemId}-group`} className="text-xs text-muted-foreground">
                        Packing group
                      </Label>
                      <Input
                        id={`${it.itemId}-group`}
                        value={groupLabels[it.itemId] ?? it.groupLabel ?? ""}
                        onChange={(e) => setGroupLabels((prev) => ({ ...prev, [it.itemId]: e.target.value }))}
                        placeholder="A"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={groupLabelMutation.isPending}
                      onClick={() =>
                        groupLabelMutation.mutate({
                          id,
                          bundleId: it.bundleId,
                          groupLabel: groupLabels[it.itemId] ?? it.groupLabel ?? null,
                        })
                      }
                    >
                      Set group
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate({ id, bundleId: it.bundleId })}
                    >
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
            emptyState={
              <EmptyState
                title="No bundles yet"
                description="Add bundles by serial search or paste below."
              />
            }
          />
        </CardContent>
      </Card>

      {/* Packing list — shown for completed dispatches */}
      {d.status === "completed" && <PackingListSection dispatchId={d.id} lengthUnit={lu.unit} />}

      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
        </CardContent>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Packing list section — embedded in dispatch detail for completed dispatches
// ---------------------------------------------------------------------------
function PackingListSection({ dispatchId, lengthUnit }: { dispatchId: string; lengthUnit: "mm" | "inch" }) {
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);
  const [qrPdfPending, setQrPdfPending] = useState(false);
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
      await downloadPackingListPdf(pl.snapshot as unknown as PLSnapshot, pl.code, lengthUnit);
    } catch {
      toast.error("PDF generation failed");
    } finally {
      setPdfPending(false);
    }
  }

  async function handleQrPdf() {
    if (!pl) return;
    setQrPdfPending(true);
    try {
      await downloadPackingListPdf(pl.snapshot as unknown as PLSnapshot, pl.code, lengthUnit, { includeQr: true });
    } catch {
      toast.error("QR PDF generation failed");
    } finally {
      setQrPdfPending(false);
    }
  }

  async function handleXlsx() {
    if (!pl) return;
    setXlsxPending(true);
    try {
      await downloadPackingListXlsx(pl.snapshot as unknown as PLSnapshot, pl.code, lengthUnit);
    } catch {
      toast.error("Excel export failed");
    } finally {
      setXlsxPending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Packing list</CardTitle>
        {pl && (
          <Link
            to="/packing-lists/$id"
            params={{ id: pl.id }}
            className="text-sm text-primary hover:underline font-mono"
          >
            {pl.code}
          </Link>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
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
            <Button size="sm" onClick={handleQrPdf} disabled={qrPdfPending} variant="outline">
              {qrPdfPending ? "Generating…" : "QR PDF"}
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
      </CardContent>
    </Card>
  );
}
