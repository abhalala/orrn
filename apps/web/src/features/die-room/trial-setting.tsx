import { useT } from "@orrn/i18n";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { useNewCopyOnTrial, useRefusal } from "./use-die-room";

/**
 * The plant switch behind FP-DR-17 (`dieRoom.newCopyOnTrial`, default on): do new copies, and copies
 * back from the die maker, start on trial? Owner and admin only (`settings.update`).
 */
export function TrialSetting() {
  const { t } = useT();
  const id = useId();
  const queryClient = useQueryClient();
  const refusal = useRefusal();
  const on = useNewCopyOnTrial();
  const save = useMutation({
    ...trpc.company.updateSettings.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.company.getSettings.queryKey() });
      toast.success(t("dieRoom.board.trialSetting.saved"));
    },
    onError: (e) => toast.error(refusal(e)),
  });
  if (on === undefined) return null;
  return (
    <Can do="settings.update">
      <div className="flex min-w-0 items-start gap-3 rounded-card border border-border bg-card p-4" data-testid="trial-setting">
        <Checkbox
          id={id}
          checked={on}
          disabled={save.isPending}
          onCheckedChange={(v) => save.mutate({ dieRoom: { newCopyOnTrial: v === true } })}
          className="mt-0.5"
        />
        <label htmlFor={id} className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[15px] leading-6 font-semibold">{t("dieRoom.board.trialSetting.title")}</span>
          <span className="text-[13px] leading-5 text-muted-foreground">{t("dieRoom.board.trialSetting.body")}</span>
        </label>
      </div>
    </Can>
  );
}
