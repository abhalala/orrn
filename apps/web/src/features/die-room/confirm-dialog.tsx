import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";

/** One question before an action that is hard to take back (cancel a job, retire, archive). */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  keepLabel,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  /** The button that backs out; default "Cancel". */
  keepLabel?: string;
  loading?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  const { t } = useT();
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !loading) onClose();
      }}
      title={title}
      description={body}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {keepLabel ?? t("common.cancel")}
          </Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
