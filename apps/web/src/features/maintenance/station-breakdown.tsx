import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { maintErrorKey, maintReady } from "./model";

/**
 * The one-tap "Make work order" on a press downtime entry with the breakdown reason (row 65). Shown only
 * to maint.workorder holders when the module is on; online only (never queued in the press outbox).
 * A second tap gets the same work order back (`replayed`), so a double tap takes one number.
 * Nothing at all shows until the server says the plant has at least one maintenance asset: a plant that
 * never set maintenance up (the module is on by default) sees no new button or hint.
 */
export function BreakdownWorkOrderButton({ downtimeId, online }: { downtimeId: string; online: boolean }) {
  const { t } = useT();
  const me = useMe();
  const qc = useQueryClient();
  const ready = maintReady(me.data, ["maint.workorder"]);
  const known = useQuery({ ...trpc.maint.workOrders.breakdowns.queryOptions(), enabled: ready, retry: false, staleTime: 30_000, meta: INLINE_ERROR_META });
  const make = useMutation({
    ...trpc.maint.workOrders.fromDowntime.mutationOptions(),
    onSuccess: (wo) => {
      toast.success(t("maint.station.workOrder", { number: wo.number }));
      void qc.invalidateQueries({ queryKey: trpc.maint.workOrders.breakdowns.queryKey() });
    },
    onError: (e) => toast.error(t(maintErrorKey(e))),
  });
  if (!ready) return null;
  return <BreakdownWorkOrderView known={known.data} downtimeId={downtimeId} online={online} made={make.data ?? null} pending={make.isPending} onMake={() => make.mutate({ downtimeId })} />;
}

export type BreakdownsKnown = { hasAssets: boolean; items: readonly { id: string; workOrderId: string | null; workOrderNumber: string | null; assetId: string | null }[] };

/** The button, the work order link or the no-asset hint; presentational so tests render it without a server. */
export function BreakdownWorkOrderView({
  known,
  downtimeId,
  online,
  made,
  pending,
  onMake,
}: {
  known: BreakdownsKnown | undefined;
  downtimeId: string;
  online: boolean;
  made: { id: string; number: string } | null;
  pending: boolean;
  onMake(): void;
}) {
  const { t } = useT();
  // Not loaded yet, or the register is empty: show nothing new.
  if (!known?.hasAssets) return null;
  const existing = known.items.find((r) => r.id === downtimeId);
  const woId = made?.id ?? existing?.workOrderId ?? null;
  const woNumber = made?.number ?? existing?.workOrderNumber ?? null;
  if (woId && woNumber) {
    return (
      <UiLink to={`/maintenance/work-orders/${woId}`} className="text-[14px] font-semibold text-foreground underline underline-offset-4">
        {t("maint.station.workOrder", { number: woNumber })}
      </UiLink>
    );
  }
  // The register has no asset on this press yet: say so instead of offering a tap the server refuses.
  if (existing && !existing.assetId) return <span className="text-[13px] text-muted-foreground">{t("maint.home.noAsset")}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={!online || pending} onClick={onMake}>
        {t("maint.station.makeWorkOrder")}
      </Button>
      {!online ? <span className="text-[13px] text-muted-foreground">{t("maint.station.offline")}</span> : null}
    </span>
  );
}
