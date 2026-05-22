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

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/bundles/$id")({
  component: BundleDetailComponent,
  beforeLoad: requireCompanyMe,
});

function statusBadgeClass(status: BundleStatus | string): string {
  switch (status) {
    case "available":
      return "bg-emerald-100 text-emerald-800";
    case "reserved":
      return "bg-amber-100 text-amber-800";
    case "dispatched":
      return "bg-sky-100 text-sky-800";
    case "void":
      return "bg-zinc-200 text-zinc-700";
    default:
      return "bg-zinc-100 text-zinc-700";
  }
}

function BundleDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    ...trpc.bundle.getBundle.queryOptions({ id }),
  });

  const transitionMutation = useMutation({
    ...trpc.bundle.transitionStatus.mutationOptions(),
    onSuccess: () => {
      toast.success("Status updated");
      setReason("");
      queryClient.invalidateQueries({ queryKey: trpc.bundle.getBundle.queryKey({ id }) });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.listBundles.queryKey() });
      queryClient.invalidateQueries({ queryKey: trpc.bundle.stockSummary.queryKey() });
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to update status");
    },
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!data) return <div className="p-8">Bundle not found.</div>;

  const { bundle, die, group, activeDispatch, events } = data;
  const isAvailable = bundle.status === "available";
  const isVoid = bundle.status === "void";
  const canTransition = isAvailable || isVoid;
  const targetStatus: BundleStatus | null = isAvailable
    ? "void"
    : isVoid
      ? "available"
      : null;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold font-mono">{bundle.serial}</h1>
          <p className="text-muted-foreground">Bundle detail</p>
        </div>
        <Button
          variant="outline"
          onClick={() =>
            navigate({ to: "/bundles", search: { status: "all", dieId: undefined, groupId: undefined } })
          }
        >
          Back to Bundles
        </Button>
      </div>

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-xs text-muted-foreground">Status</Label>
            <div className="mt-1">
              <span className={`text-sm font-medium px-3 py-1 rounded ${statusBadgeClass(bundle.status)}`}>
                {bundle.status}
              </span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <Label className="text-xs text-muted-foreground">Die</Label>
            <p className="font-medium">
              {die ? `${die.series} / ${die.sectionCode}${die.name ? ` — ${die.name}` : ""}` : "—"}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Receipt</Label>
            <p className="font-mono text-sm">
              {group ? (
                <Link to="/receipts/$id" params={{ id: group.id }} className="hover:underline">
                  {group.code}
                </Link>
              ) : (
                "—"
              )}
            </p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Quantity</Label>
            <p>{bundle.quantity}</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Weight</Label>
            <p>{bundle.weightG} g</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Length</Label>
            <p>{bundle.lengthMm} mm</p>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Created</Label>
            <p>{format(new Date(bundle.createdAt), "PP p")}</p>
          </div>
        </div>
      </div>

      {activeDispatch && (
        <div className="bg-card border rounded-lg p-4 flex items-center justify-between">
          <div>
            <Label className="text-xs text-muted-foreground">Active dispatch</Label>
            <p className="font-mono text-sm">{activeDispatch.code}</p>
            <p className="text-xs text-muted-foreground capitalize">Status: {activeDispatch.status}</p>
          </div>
          <Link to="/dispatches/$id" params={{ id: activeDispatch.id }}>
            <Button variant="outline" size="sm">View dispatch</Button>
          </Link>
        </div>
      )}

      {canTransition && targetStatus && (
        <Can do="bundle.transition">
          <div className="bg-card border rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold">
              {isAvailable ? "Void this bundle" : "Restore this bundle"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isAvailable
                ? "Voiding marks the bundle as no longer part of available stock. It can be restored later."
                : "Restoring returns the bundle to available stock."}
            </p>
            <div className="space-y-2">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. damaged in handling"
              />
            </div>
            <Button
              variant={isAvailable ? "destructive" : "default"}
              onClick={() =>
                transitionMutation.mutate({ id, toStatus: targetStatus, reason: reason || null })
              }
              disabled={transitionMutation.isPending}
            >
              {transitionMutation.isPending
                ? "Saving..."
                : isAvailable
                  ? "Void bundle"
                  : "Restore bundle"}
            </Button>
          </div>
        </Can>
      )}

      {!canTransition && (
        <div className="bg-muted/50 border rounded-lg p-4 text-sm text-muted-foreground">
          This bundle is currently {bundle.status}. Status changes are managed by the dispatch flow.
        </div>
      )}

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold">Status history</h2>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ul className="space-y-2">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between text-sm border-b last:border-b-0 pb-2"
              >
                <div className="space-x-2">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${statusBadgeClass(ev.fromStatus ?? "")}`}>
                    {ev.fromStatus ?? "new"}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className={`text-xs font-medium px-2 py-1 rounded ${statusBadgeClass(ev.toStatus)}`}>
                    {ev.toStatus}
                  </span>
                  {ev.reason && <span className="text-muted-foreground">— {ev.reason}</span>}
                </div>
                <span className="text-xs text-muted-foreground">
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
