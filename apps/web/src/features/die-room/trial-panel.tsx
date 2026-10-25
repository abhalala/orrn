import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import type { CardData } from "./types";
import { useRefreshDieRoom, useRefusal } from "./use-die-room";

/**
 * A copy on trial (FP-DR-17): it goes only to a die trial run, and becomes available when a trial
 * passes. A manager can release it without a trial, with a reason; the reason is kept in the audit
 * trail. The pass itself is written by the trial run's close, never from here.
 */
export function TrialPanel({ card }: { card: CardData }) {
  const { t } = useT();
  const refresh = useRefreshDieRoom();
  const refusal = useRefusal();
  const { instance } = card;
  const [releasing, setReleasing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const release = useMutation({
    ...trpc.dieInstance.trialPass.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setReleasing(false);
      setReason("");
      setError(null);
      toast.success(t("dieRoom.trial.releasedToast", { code: instance.code }));
    },
    onError: (e) => setError(refusal(e)),
  });

  if (instance.status !== "on_trial") return null;
  return (
    <section
      aria-labelledby="trial-title"
      data-testid="trial-panel"
      className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-tone-amber-tint p-4 text-foreground"
    >
      <h2 id="trial-title" className="m-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">
        {t("dieRoom.trial.title")}
      </h2>
      <p className="m-0 text-[14px] leading-6">{t("dieRoom.trial.body")}</p>
      <div className="flex flex-wrap gap-2">
        <Can do="die.issue">
          <Button asChild variant="secondary">
            <Link to="/dies/issues">{t("dieRoom.trial.issueToTrial")}</Link>
          </Button>
        </Can>
        <Can do="masters.publish">
          <Button variant="secondary" onClick={() => setReleasing(true)} data-testid="trial-release">
            {t("dieRoom.trial.release")}
          </Button>
        </Can>
      </div>

      <Dialog
        open={releasing}
        onOpenChange={(o) => {
          if (!o && !release.isPending) setReleasing(false);
        }}
        title={t("dieRoom.trial.releaseTitle", { code: instance.code })}
        description={t("dieRoom.trial.releaseBody")}
        actions={
          <>
            <Button variant="secondary" disabled={release.isPending} onClick={() => setReleasing(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              loading={release.isPending}
              onClick={() => {
                if (reason.trim().length < 3) return setError(t("dieRoom.trial.reasonRequired"));
                setError(null);
                release.mutate({ id: instance.id, reason: reason.trim() });
              }}
              data-testid="trial-release-confirm"
            >
              {t("dieRoom.trial.releaseConfirm")}
            </Button>
          </>
        }
      >
        <Field label={t("common.reason")}>
          <FieldTextArea value={reason} onChangeText={setReason} rows={3} maxLength={500} />
        </Field>
        {error ? (
          <p role="alert" className="m-0 mt-2 text-[14px] leading-5 font-medium text-destructive">
            {error}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
