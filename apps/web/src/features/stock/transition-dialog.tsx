import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { renderScanMessage } from "@/features/scan/scan-outcome";
import { trpc } from "@/shared/utils/trpc";

import { transitionError } from "./format";

const REASON_MAX = 500;

/**
 * Void or Restore with a reason (spec §3 `/b/:serial`, guide `void-bundle`).
 * Void needs a reason: it is the audit trail for a bundle that leaves stock.
 * Restore's reason is optional. The server keeps the rule that only an
 * in-stock bundle can be voided and only a void one restored.
 */
export function TransitionDialog({
  open,
  onOpenChange,
  bundleId,
  to,
  onDone,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  bundleId: string;
  to: "void" | "available";
  onDone(): void;
}) {
  const { t } = useT();
  const formId = useId();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const voiding = to === "void";

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
    }
  }, [open]);

  const transition = useMutation(trpc.bundle.transitionStatus.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = reason.trim();
    if (voiding && !text) {
      setError(t("bundle.reasonRequired"));
      return;
    }
    setError(null);
    transition.mutate(
      { id: bundleId, toStatus: to, reason: text || null },
      {
        onSuccess: () => {
          toast.success(t(voiding ? "bundle.voided" : "bundle.restored"));
          onOpenChange(false);
          onDone();
        },
        onError: (err) => {
          if (err.data?.code === "BAD_REQUEST") {
            // The bundle changed since the page loaded: say how, close, and show where it is now.
            toast.error(renderScanMessage(t, transitionError(err)));
            onOpenChange(false);
            onDone();
            return;
          }
          setError(renderScanMessage(t, transitionError(err)));
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t(voiding ? "bundle.voidTitle" : "bundle.restoreTitle")}
      description={t(voiding ? "bundle.voidBody" : "bundle.restoreBody")}
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form={formId} variant={voiding ? "danger" : "primary"} loading={transition.isPending}>
            {t(voiding ? "bundle.void" : "bundle.restore")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate>
        <Field
          label={voiding ? t("bundle.reason") : `${t("bundle.reason")} (${t("common.optional")})`}
          hint={t("bundle.reasonHint")}
          error={error ?? undefined}
        >
          <TextInput
            value={reason}
            onChangeText={setReason}
            maxLength={REASON_MAX}
            autoComplete="off"
            aria-required={voiding || undefined}
            data-testid="transition-reason"
          />
        </Field>
      </form>
    </Dialog>
  );
}
