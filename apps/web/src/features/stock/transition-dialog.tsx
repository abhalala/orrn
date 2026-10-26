import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { BundleVoidNote, ageingRefusalText } from "@/features/ageing/bundle-trace";
import { renderScanMessage } from "@/features/scan/scan-outcome";
import { trpc } from "@/shared/utils/trpc";

import { transitionError } from "./format";

const REASON_MAX = 500;

/**
 * Void or Restore with a reason (spec §3 `/b/:serial`, guide `void-bundle`).
 * Void needs a reason: it is the audit trail for a bundle that leaves stock.
 * Restore's reason is optional. The server keeps the rule that only an
 * in-stock bundle can be voided and only a void one restored.
 *
 * Errors are heard, not only seen (WCAG 4.1.3): a missing reason moves focus
 * to the Reason field, whose description then reads the error (or, when the
 * field already has focus, a polite live line says it); a failure that is not
 * about the reason (role, connection) is a dialog message with role="alert",
 * never an error on a reason that is fine.
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
  /** The Reason field's own problem (only "write a reason"). */
  const [error, setError] = useState<string | null>(null);
  /** Anything else that stopped the change: shown for the whole dialog. */
  const [failure, setFailure] = useState<string | null>(null);
  /** Said by a live line when focus is already in the field (moving focus there would say nothing). */
  const [announce, setAnnounce] = useState("");
  const [focusRequest, setFocusRequest] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const voiding = to === "void";

  useEffect(() => {
    if (open) {
      setReason("");
      setError(null);
      setFailure(null);
      setAnnounce("");
    }
  }, [open]);

  // After the error has rendered, so the field's aria-describedby already names it.
  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const transition = useMutation(trpc.bundle.transitionStatus.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = reason.trim();
    setFailure(null);
    if (voiding && !text) {
      const message = t("bundle.reasonRequired");
      setError(message);
      if (document.activeElement === inputRef.current) {
        setAnnounce(message);
      } else {
        setAnnounce("");
        setFocusRequest((n) => n + 1);
      }
      return;
    }
    setError(null);
    setAnnounce("");
    transition.mutate(
      { id: bundleId, toStatus: to, reason: text || null },
      {
        onSuccess: () => {
          toast.success(t(voiding ? "bundle.voided" : "bundle.restored"));
          onOpenChange(false);
          onDone();
        },
        onError: (err) => {
          // A restore that cannot draw its trolley line again says so and stays open.
          const ageing = ageingRefusalText(t, err);
          if (ageing) {
            setFailure(ageing);
            return;
          }
          if (err.data?.code === "BAD_REQUEST") {
            // The bundle changed since the page loaded: say how, close, and show where it is now.
            toast.error(renderScanMessage(t, transitionError(err)));
            onOpenChange(false);
            onDone();
            return;
          }
          setFailure(renderScanMessage(t, transitionError(err)));
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
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        {failure ? (
          <p
            key={failure}
            role="alert"
            className="m-0 flex items-start gap-2 rounded-card border border-destructive px-3.5 py-3 text-[14px] font-medium leading-5 text-destructive"
          >
            <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>{failure}</span>
          </p>
        ) : null}
        {voiding ? <BundleVoidNote bundleId={bundleId} enabled={open} /> : null}
        <Field
          label={voiding ? t("bundle.reason") : `${t("bundle.reason")} (${t("common.optional")})`}
          hint={t("bundle.reasonHint")}
          error={error ?? undefined}
        >
          <TextInput
            ref={inputRef}
            value={reason}
            onChangeText={(next) => {
              setReason(next);
              setAnnounce("");
            }}
            maxLength={REASON_MAX}
            autoComplete="off"
            aria-required={voiding || undefined}
            data-testid="transition-reason"
          />
        </Field>
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </form>
    </Dialog>
  );
}
