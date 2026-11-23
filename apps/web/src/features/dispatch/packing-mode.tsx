import { useT } from "@orrn/i18n";
import { Card, CardTitle } from "@orrn/ui/components/card";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { serverRefusal } from "@/features/shared/server-refusal";
import { MasterPicker } from "@/shared/components/master-picker";
import { trpc } from "@/shared/utils/trpc";
import { useModuleOn } from "@/shared/lib/modules";

/**
 * Mode of packing for the whole load (`masters.packing.setForDispatch`); it prints on the packing list.
 * The caller gates it with `<Can>` and hides it for a cancelled dispatch.
 */
function DispatchPackingModeInner({ dispatchId, current }: { dispatchId: string; current: string | null }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const set = useMutation({
    ...trpc.masters.packing.setForDispatch.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.dispatch.getDispatch.queryKey({ id: dispatchId }) });
      toast.success(t("adm.floor.packing.saved"));
    },
    onError: (e) => toast.error(serverRefusal(t, e)),
  });
  return (
    <Card className="min-w-0" data-testid="dispatch-packing-mode">
      <CardTitle as="h2">{t("adm.kindOne.packing_mode")}</CardTitle>
      <div className="max-w-sm">
        <MasterPicker
          kind="packing_mode"
          value={current}
          aria-label={t("adm.floor.packing.forLoad")}
          disabled={set.isPending}
          onChange={(packingModeId) => set.mutate({ dispatchId, packingModeId })}
        />
      </div>
    </Card>
  );
}

/** PROD-GATE: renders (and asks the server) only with the opt-in `masters_plus` module on. */
export function DispatchPackingMode(props: Parameters<typeof DispatchPackingModeInner>[0]) {
  return useModuleOn("masters_plus") ? <DispatchPackingModeInner {...props} /> : null;
}
