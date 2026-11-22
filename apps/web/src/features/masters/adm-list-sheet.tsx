import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { UnitField } from "@/shared/components/unit-field";
import { trpc } from "@/shared/utils/trpc";

import type { PlantListKind } from "./adm-search";
import { AdmSheet } from "./adm-ui";
import { useAdmInvalidate, type PlantListRow } from "./adm-use";

/**
 * Add or rename an entry of a plant list (masters.publish). A die category also carries the weight a
 * die of that category is expected to push; editing can retire or bring the entry back.
 */
export function PlantListSheet({
  open,
  onOpenChange,
  kind,
  row,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  kind: PlantListKind;
  row?: PlantListRow;
}) {
  const { t } = useT();
  const invalidate = useAdmInvalidate();
  const formId = `plant-list-form-${useId().replace(/:/g, "")}`;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [lifeG, setLifeG] = useState<number | null>(null);
  const [error, setError] = useState<string | undefined>();

  const create = useMutation(trpc.masters.lists.create.mutationOptions());
  const update = useMutation(trpc.masters.lists.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(row?.name ?? "");
    setLifeG(row?.expectedLifeG ?? null);
    setError(undefined);
    create.reset();
    update.reset();
    // Only when the sheet opens; mutations are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row?.id]);

  const close = () => onOpenChange(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) {
      setError(t("masters.errors.nameRequired"));
      return nameRef.current?.focus();
    }
    setError(undefined);
    try {
      if (row) {
        await update.mutateAsync({ id: row.id, name: name.trim(), ...(kind === "die_category" ? { expectedLifeG: lifeG } : {}) });
        toast.success(t("masters.saved", { name: name.trim() }));
      } else {
        await create.mutateAsync({ kind, name: name.trim(), ...(kind === "die_category" && lifeG !== null ? { expectedLifeG: lifeG } : {}) });
        toast.success(t("masters.added", { name: name.trim() }));
      }
      await invalidate.lists();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  const toggle = async () => {
    if (!row || busy) return;
    try {
      await update.mutateAsync({ id: row.id, active: !row.active });
      toast.success(t(row.active ? "masters.retired" : "masters.restored", { name: row.name }));
      await invalidate.lists();
      close();
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <AdmSheet
      open={open}
      onOpenChange={onOpenChange}
      title={row ? t("adm.masters.lists.form.editTitle", { name: row.name }) : t("adm.masters.lists.form.addTitle")}
      description={t(`adm.kindOne.${kind}`)}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("adm.masters.lists.form.save")}
      editors="masters.publish"
      retire={row ? { active: row.active, hint: t("masters.retireHint"), onToggle: () => void toggle() } : undefined}
    >
      <Field label={t("adm.masters.lists.form.name")} error={error}>
        <TextInput
          ref={nameRef}
          value={name}
          maxLength={60}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setName(v);
            if (error && v.trim()) setError(undefined);
          }}
        />
      </Field>
      {kind === "die_category" ? (
        <UnitField field="order.weight" label={t("adm.masters.lists.form.life")} hint={t("adm.masters.lists.form.lifeHint")} value={lifeG} onValueChange={setLifeG} />
      ) : null}
    </AdmSheet>
  );
}
