import { formatKgTotal, gToKg } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { addOutcome, renderScanMessage } from "@/features/scan/scan-outcome";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";


/**
 * "Add to dispatch" (spec §3 `/b/:serial`): a sheet listing the dispatches
 * being built (draft). One tap adds the bundle through
 * `dispatch.addBundlesBySerial`, whose report says what happened without
 * failing the request: added, already there (calm, Review Focus 1), or
 * blocked with the server's reason.
 */
export function AddToDispatchSheet({
  open,
  onOpenChange,
  serial,
  description,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  serial: string;
  /** One line under the title: the bundle and its weight. */
  description: string;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [pendingId, setPendingId] = useState<string | null>(null);

  const drafts = useQuery({
    ...trpc.dispatch.listDispatches.queryOptions({ status: "draft", limit: 50 }),
    enabled: open,
  });

  const add = useMutation(
    trpc.dispatch.addBundlesBySerial.mutationOptions({
      onSettled: () => setPendingId(null),
    }),
  );

  const choose = (d: { id: string; code: string }) => {
    if (add.isPending) return;
    setPendingId(d.id);
    add.mutate(
      { id: d.id, serials: [serial] },
      {
        onSuccess: (report) => {
          const outcome = addOutcome(report, serial);
          void queryClient.invalidateQueries({ queryKey: trpc.dispatch.listDispatches.queryKey() });
          void queryClient.invalidateQueries({ queryKey: trpc.bundle.getBySerial.queryKey() });
          const openAction = { label: t("bundle.openDispatchPlain"), onClick: () => navigate({ to: "/dispatch/$id", params: { id: d.id } }) };
          if (outcome.kind === "added") {
            toast.success(t("bundle.addedToDispatch", { code: d.code }), { action: openAction });
            onOpenChange(false);
          } else if (outcome.kind === "already") {
            toast(t("bundle.alreadyInDispatch", { code: d.code }), { action: openAction });
            onOpenChange(false);
          } else if (outcome.kind === "rejected") {
            // Held, dispatched or voided since the page loaded: the page refreshes to show it.
            toast.error(renderScanMessage(t, outcome.message));
            onOpenChange(false);
          } else {
            toast.error(t("bundle.addNotFound"));
          }
        },
        onError: (error) => {
          toast.error(error.data?.code === "FORBIDDEN" ? t("stock.noPermission") : t("bundle.addFailed"));
        },
      },
    );
  };

  const items = drafts.data?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t("bundle.addToDispatch")} description={description}>
      {drafts.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2 pt-1">
          <span className="sr-only">{t("common.loading")}</span>
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-[68px] w-full rounded-card" />
          ))}
        </div>
      ) : drafts.isError ? (
        <EmptyState
          className="py-8"
          title={t("bundle.dispatchesLoadError")}
          action={
            <Button variant="secondary" onClick={() => void drafts.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          className="py-8"
          title={t("bundle.noBuildingDispatches")}
          action={
            <Can do="dispatch.create">
              <Button asChild>
                <Link to="/dispatch/new">{t("bundle.newDispatch")}</Link>
              </Button>
            </Can>
          }
        />
      ) : (
        <ul
          aria-label={t("bundle.chooseDispatch")}
          data-testid="draft-dispatches"
          className="m-0 flex list-none flex-col gap-2 p-0 pt-1"
        >
          {items.map((d) => {
            const busy = pendingId === d.id;
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => choose(d)}
                  disabled={add.isPending}
                  aria-busy={busy || undefined}
                  className="animate-press flex min-h-[68px] w-full min-w-0 items-center gap-3 rounded-card border border-border bg-card px-4 py-3 text-left transition-[background-color,scale,opacity] duration-[var(--dur-fast)] hover:bg-surface-sunken disabled:opacity-60"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="font-mono text-[16px] font-semibold leading-6">{d.code}</span>
                    <span className="text-[14px] leading-5 break-words text-muted-foreground">
                      {d.customerName}
                    </span>
                    <span className="text-[13px] leading-5 text-muted-foreground tabular-nums">
                      {t("units.bundlesKg", {
                        bundles: Number(d.itemCount),
                        kg: formatKgTotal(gToKg(Number(d.totalWeightG))),
                      })}
                    </span>
                  </span>
                  {busy ? (
                    <Loader2 aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 animate-spin" />
                  ) : (
                    <ChevronRight aria-hidden="true" strokeWidth={2} className="size-5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}
