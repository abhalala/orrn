/** A dialog that asks for a short reason (3 characters at least) before something that cannot be taken back lightly. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useEffect, useState, type ReactNode } from "react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  /** Extra fields shown above the reason (a reason code). */
  extra?: ReactNode;
  onConfirm: (reason: string) => void;
};

export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, danger, pending, extra, onConfirm }: Props) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setReason("");
      setTried(false);
    }
  }, [open]);
  const ok = reason.trim().length >= 3;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      actions={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={pending}
            onClick={() => {
              setTried(true);
              if (ok) onConfirm(reason.trim());
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {extra}
      <Field label={t("bill.reason.label")} error={tried && !ok ? t("bill.reason.short") : undefined}>
        <TextInput value={reason} onChangeText={setReason} maxLength={300} />
      </Field>
    </Dialog>
  );
}
