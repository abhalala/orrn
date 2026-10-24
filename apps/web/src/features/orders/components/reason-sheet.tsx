import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useEffect, useState } from "react";

import { FieldTextArea } from "@/features/catalog/field-text-area";

/** A sheet that asks "why" before a Close or a Cancel. The reason is required when `required`. */
export function ReasonSheet({
  open,
  onOpenChange,
  title,
  description,
  label,
  submitLabel,
  required,
  busy,
  errors,
  onSubmit,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description?: string;
  label: string;
  submitLabel: string;
  required: boolean;
  busy: boolean;
  errors: string[];
  onSubmit(reason: string): void;
}) {
  const { t } = useT();
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  const blocked = required && reason.trim() === "";
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.back")}
          </Button>
          <Button onClick={() => onSubmit(reason.trim())} disabled={blocked || busy}>
            {busy ? t("common.saving") : submitLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={label}>
          <FieldTextArea value={reason} onChangeText={setReason} rows={3} />
        </Field>
        {errors.length > 0 ? (
          <div role="alert" className="flex flex-col gap-1">
            {errors.map((e) => (
              <p key={e} className="m-0 text-[14px] font-medium leading-5 text-destructive">
                {e}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
