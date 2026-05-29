import { StatusBadge } from "@orrn/ui/components/badge";
import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Input } from "@orrn/ui/components/input";
import { Label } from "@orrn/ui/components/label";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@orrn/web-shared/components/can";
import { useLengthUnit } from "@orrn/web-shared/lib/length";
import { requireCompanyMe } from "@orrn/web-shared/lib/erp-guards";
import { trpc } from "@orrn/web-shared/utils/trpc";

const bundleStatuses = ["available", "reserved", "dispatched", "void"] as const;
type BundleStatus = (typeof bundleStatuses)[number];

export const Route = createFileRoute("/bundles/$id")({
  component: BundleDetailComponent,
  beforeLoad: requireCompanyMe,
});

function BundleDetailComponent() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const lu = useLengthUnit();

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

  if (isLoading) return <div>Loading…</div>;
  if (!data) return <EmptyState title="Bundle not found" description="This bundle may have been removed." />;

  const { bundle, die, group, activeDispatch, events } = data;
  const isAvailable = bundle.status === "available";
  const isVoid = bundle.status === "void";
  const canTransition = isAvailable || isVoid;
  const targetStatus: BundleStatus | null = isAvailable ? "void" : isVoid ? "available" : null;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Bundles"
        title={bundle.serial}
        description="Bundle detail and status history."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              navigate({ to: "/bundles", search: { status: "all", dieId: undefined, groupId: undefined } })
            }
          >
            Back to list
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Overview</CardTitle>
            <StatusBadge kind="bundle" value={bundle.status} />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
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
              <p>{lu.formatLength(bundle.lengthMm)}</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Created</Label>
              <p>{format(new Date(bundle.createdAt), "PP p")}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {activeDispatch ? (
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Active dispatch</Label>
              <p className="font-mono text-sm">{activeDispatch.code}</p>
              <StatusBadge kind="dispatch" value={activeDispatch.status} size="sm" />
            </div>
            <Link to="/dispatches/$id" params={{ id: activeDispatch.id }}>
              <Button variant="outline" size="sm">
                View dispatch
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {canTransition && targetStatus ? (
        <Can do="bundle.transition">
          <Card>
            <CardHeader>
              <CardTitle>{isAvailable ? "Void this bundle" : "Restore this bundle"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  onChangeText={setReason}
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
                  ? "Saving…"
                  : isAvailable
                    ? "Void bundle"
                    : "Restore bundle"}
              </Button>
            </CardContent>
          </Card>
        </Can>
      ) : (
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              This bundle is currently {bundle.status}. Status changes are managed by the dispatch flow.
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Status history</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState title="No history yet" description="Status transitions will appear here." />
          ) : (
            <ul className="space-y-3">
              {events.map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-wrap items-center justify-between gap-2 text-sm border-b border-border last:border-b-0 pb-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="bundle" value={ev.fromStatus ?? "available"} size="sm" />
                    <span className="text-muted-foreground">→</span>
                    <StatusBadge kind="bundle" value={ev.toStatus} size="sm" />
                    {ev.reason ? <span className="text-muted-foreground">— {ev.reason}</span> : null}
                  </div>
                  <span className="text-xs text-muted-foreground">
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
