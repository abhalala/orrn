import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { MasterSheet } from "./masters-ui";
import type { ReasonKind } from "./search";
import { useInvalidate, type ReasonRow } from "./use-masters";

/**
 * Add or rename a reason (masters.publish): the English wording, optional Hindi and Gujarati
 * wording, and whether picking it asks for a note. When editing: retire or bring back. A reason's
 * key is made from the English wording once and never changes.
 */
export function ReasonSheet({
  open,
  onOpenChange,
  kind,
  row,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  kind: ReasonKind;
  row?: ReasonRow;
}) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const formId = `reason-form-${useId().replace(/:/g, "")}`;
  const labelRef = useRef<HTMLInputElement | null>(null);
  const [label, setLabel] = useState("");
  const [hi, setHi] = useState("");
  const [gu, setGu] = useState("");
  const [note, setNote] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const create = useMutation(trpc.reasonCodes.create.mutationOptions());
  const rename = useMutation(trpc.reasonCodes.rename.mutationOptions());
  const setActive = useMutation(trpc.reasonCodes.setActive.mutationOptions());
  const busy = create.isPending || rename.isPending || setActive.isPending;

  useEffect(() => {
    if (!open) return;
    setLabel(row?.label ?? "");
    setHi(row?.labelHi ?? "");
    setGu(row?.labelGu ?? "");
    setNote(row?.requiresNote ?? false);
    setError(undefined);
    create.reset();
    rename.reset();
    setActive.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const close = () => onOpenChange(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!label.trim()) {
      setError(t("masters.reasons.form.labelRequired"));
      return labelRef.current?.focus();
    }
    setError(undefined);
    try {
      if (row) {
        await rename.mutateAsync({ id: row.id, label: label.trim(), labelHi: hi.trim() || null, labelGu: gu.trim() || null, requiresNote: note });
        toast.success(t("masters.saved", { name: label.trim() }));
      } else {
        await create.mutateAsync({ kind, label: label.trim(), labelHi: hi.trim() || null, labelGu: gu.trim() || null, requiresNote: note });
        toast.success(t("masters.added", { name: label.trim() }));
      }
      await invalidate.reasons();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await setActive.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.label }));
      await invalidate.reasons();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("masters.reasons.form.editTitle", { name: row.label }) : t("masters.reasons.form.addTitle")}
      description={t(`reasons.kinds.${kind}`)}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? rename.error ?? setActive.error}
      saveLabel={t("masters.reasons.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("masters.reasons.form.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      <Field label={t("masters.reasons.form.english")} hint={t("masters.reasons.form.englishHint")} error={error}>
        <TextInput
          ref={labelRef}
          value={label}
          maxLength={80}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setLabel(v);
            if (error && v.trim()) setError(undefined);
          }}
        />
      </Field>
      <Field label={t("masters.reasons.form.hindi")} hint={t("masters.reasons.form.translationHint")}>
        <TextInput value={hi} maxLength={80} autoComplete="off" lang="hi" onChangeText={setHi} />
      </Field>
      <Field label={t("masters.reasons.form.gujarati")}>
        <TextInput value={gu} maxLength={80} autoComplete="off" lang="gu" onChangeText={setGu} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input type="checkbox" checked={note} onChange={(e) => setNote(e.currentTarget.checked)} className="size-5 accent-[var(--color-foreground)]" />
        <span>{t("masters.reasons.form.note")}</span>
      </label>
    </MasterSheet>
  );
}
