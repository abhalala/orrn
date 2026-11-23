import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { UiLink } from "@orrn/ui/components/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

import { maintErrorKey, maintReady } from "./model";

/**
 * The one-tap "Make work order" on a press downtime entry with the breakdown reason (row 65). Shown only
 * to maint.workorder holders when the module is on; online only (never queued in the press outbox).
 * A second tap gets the same work order back (`replayed`), so a double tap takes one number.
 */
export function BreakdownWorkOrderButton({ downtimeId, online }: { downtimeId: string; online: boolean }) {
  const { t } = useT();
  const me = useMe();
  const qc = useQueryClient();
  const ready = maintReady(me.data, ["maint.workorder"]);
  const known = useQuery({ ...trpc.maint.workOrders.breakdowns.queryOptions(), enabled: ready, retry: false, staleTime: 30_000 });
  const make = useMutation({
    ...trpc.maint.workOrders.fromDowntime.mutationOptions(),
    onSuccess: (wo) => {
      toast.success(t("maint.station.workOrder", { number: wo.number }));
      void qc.invalidateQueries({ queryKey: trpc.maint.workOrders.breakdowns.queryKey() });
    },
    onError: (e) => toast.error(t(maintErrorKey(e))),
  });
  if (!ready) return null;
  const existing = known.data?.find((r) => r.id === downtimeId);
  const woId = make.data?.id ?? existing?.workOrderId ?? null;
  const woNumber = make.data?.number ?? existing?.workOrderNumber ?? null;
  if (woId && woNumber) {
    return (
      <UiLink to={`/maintenance/work-orders/${woId}`} className="text-[14px] font-semibold text-foreground underline underline-offset-4">
        {t("maint.station.workOrder", { number: woNumber })}
      </UiLink>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" disabled={!online || make.isPending} onClick={() => make.mutate({ downtimeId })}>
        {t("maint.station.makeWorkOrder")}
      </Button>
      {!online ? <span className="text-[13px] text-muted-foreground">{t("maint.station.offline")}</span> : null}
    </span>
  );
}
