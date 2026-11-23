import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { useJobworkInvalidate, type StepDetail } from "./hooks";
import { routerOf } from "./model";
import { FormSheet } from "./ui";

/** Cancel a step before anything came back: the bundles go back where they came from and the holds are released. Needs a reason. */
export function CancelSheet({ data, open, onOpenChange }: { data: StepDetail; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const invalidate = useJobworkInvalidate();
  const step = data.step;
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setTried(false);
    }
  }, [open]);
  const onSuccess = async () => {
    toast.success(t("jw.cancel.done", { number: step.number }));
    await invalidate();
    onOpenChange(false);
  };
  const viaSteps = useOnceMutation(trpc.process.steps.cancel.mutationOptions({ onSuccess }));
  const viaDraw = useOnceMutation(trpc.drawbench.cancel.mutationOptions({ onSuccess }));
  const viaFab = useOnceMutation(trpc.fabrication.cancel.mutationOptions({ onSuccess }));
  const router = routerOf(step.kind);
  const m = router === "drawbench" ? viaDraw : router === "fabrication" ? viaFab : viaSteps;
  const missing = reason.trim() === "";
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("jw.cancel.title", { number: step.number })}
      description={t("jw.cancel.body")}
      busy={m.isPending}
      error={m.error}
      submitLabel={t("jw.action.cancelStep")}
      submitTone="danger"
      testId="cancel-form"
      onSubmit={() => {
        setTried(true);
        if (missing) return;
        const body = { id: step.id, reason: reason.trim() };
        if (router === "drawbench") viaDraw.mutate(body);
        else if (router === "fabrication") viaFab.mutate(body);
        else viaSteps.mutate(body);
      }}
    >
      <Field label={t("jw.cancel.reason")} error={tried && missing ? t("jw.error.reason") : undefined} required>
        <TextInput value={reason} maxLength={300} onChange={(e) => setReason(e.currentTarget.value)} data-testid="cancel-reason" />
      </Field>
    </FormSheet>
  );
}
