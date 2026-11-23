import { useT } from "@orrn/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { MasterPicker } from "@/shared/components/master-picker";
import { trpc } from "@/shared/utils/trpc";
import { useModuleOn } from "@/shared/lib/modules";

/**
 * Mode of packing for one order line (`masters.packing.setForLine`). The stored mode comes from
 * `masters.packing.forOrder` (one read per order, shared by every line through the query cache).
 */
function LinePackingModeInner({ orderId, lineId, lineNo }: { orderId: string; lineId: string; lineNo: number }) {
  const { t } = useT();
  const qc = useQueryClient();
  const stored = useQuery(trpc.masters.packing.forOrder.queryOptions({ orderId }));
  const chosen = stored.data?.find((r) => r.lineId === lineId)?.packingModeId ?? null;
  const set = useMutation({
    ...trpc.masters.packing.setForLine.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: trpc.masters.packing.forOrder.queryKey({ orderId }) });
      toast.success(t("adm.floor.packing.saved"));
    },
    onError: (e) => toast.error(serverRefusal(t, e)),
  });
  return (
    <div className="flex min-w-0 max-w-sm flex-col gap-1" data-packing-line={lineNo}>
      <span className="text-[13px] font-medium text-muted-foreground">{t("adm.kindOne.packing_mode")}</span>
      <MasterPicker
        kind="packing_mode"
        value={chosen}
        aria-label={`${t("adm.floor.packing.forLine")} ${lineNo}`}
        disabled={set.isPending || stored.isPending}
        onChange={(packingModeId) => set.mutate({ lineId, packingModeId })}
      />
    </div>
  );
}

/** PROD-GATE: renders (and asks the server) only with the opt-in `masters_plus` module on. */
export function LinePackingMode(props: Parameters<typeof LinePackingModeInner>[0]) {
  return useModuleOn("masters_plus") ? <LinePackingModeInner {...props} /> : null;
}
