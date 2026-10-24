import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { trpc } from "@/shared/utils/trpc";

import { gstinProblem, nameKey, spellingsFromText } from "./masters-model";
import { FieldTextArea, MasterSheet } from "./masters-ui";
import { useInvalidate } from "./use-masters";

export type EditableVendor = {
  id: string;
  name: string;
  gstin: string | null;
  phone: string | null;
  city: string | null;
  notes: string | null;
};

/**
 * Add a vendor (confirmed at once: masters.publish) with its other spellings, or edit one. GSTIN is
 * optional (unregistered vendors) and checked against the same pattern as the server before saving.
 */
export function VendorSheet({
  open,
  onOpenChange,
  vendor,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  vendor?: EditableVendor;
  onCreated?(id: string): void;
}) {
  const { t } = useT();
  const invalidate = useInvalidate();
  const formId = `vendor-form-${useId().replace(/:/g, "")}`;
  const nameRef = useRef<HTMLInputElement | null>(null);
  const gstinRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [gstin, setGstin] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [notes, setNotes] = useState("");
  const [spellings, setSpellings] = useState("");
  const [errors, setErrors] = useState<{ name?: string; gstin?: string }>({});
  const create = useMutation(trpc.vendor.create.mutationOptions());
  const update = useMutation(trpc.vendor.update.mutationOptions());
  const busy = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    setName(vendor?.name ?? "");
    setGstin(vendor?.gstin ?? "");
    setPhone(vendor?.phone ?? "");
    setCity(vendor?.city ?? "");
    setNotes(vendor?.notes ?? "");
    setSpellings("");
    setErrors({});
    create.reset();
    update.reset();
    // Only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vendor?.id]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const next = {
      name: nameKey(name) ? undefined : t("vendors.form.nameRequired"),
      gstin: gstinProblem(gstin) ? t("vendors.form.gstinInvalid") : undefined,
    };
    setErrors(next);
    if (next.name) return nameRef.current?.focus();
    if (next.gstin) return gstinRef.current?.focus();
    const text = (v: string) => v.trim() || null;
    const fields = {
      name: name.trim(),
      gstin: text(gstin)?.toUpperCase() ?? null,
      phone: text(phone),
      city: text(city),
      notes: text(notes),
    };
    try {
      if (vendor) {
        const patch = Object.fromEntries(
          Object.entries(fields).filter(([k, v]) => v !== (vendor[k as keyof EditableVendor] ?? null)),
        );
        await update.mutateAsync({ id: vendor.id, ...patch });
        toast.success(t("masters.saved", { name: fields.name }));
      } else {
        const list = spellingsFromText(spellings);
        const res = await create.mutateAsync({ ...fields, ...(list.length ? { aliases: list } : {}) });
        toast.success(t("masters.added", { name: fields.name }));
        onCreated?.(res.id);
      }
      await invalidate.vendors();
      onOpenChange(false);
    } catch {
      // Shown in the sheet.
    }
  };

  return (
    <MasterSheet
      open={open}
      onOpenChange={onOpenChange}
      title={vendor ? t("vendors.form.editTitle") : t("vendors.form.addTitle")}
      formId={formId}
      onSubmit={(e) => void submit(e)}
      busy={busy}
      error={create.error ?? update.error}
      saveLabel={t("vendors.form.save")}
      editors="masters.publish"
    >
      <Field label={t("vendors.form.name")} hint={t("vendors.form.nameHint")} error={errors.name}>
        <TextInput
          ref={nameRef}
          value={name}
          maxLength={120}
          autoComplete="off"
          aria-required="true"
          onChangeText={(v) => {
            setName(v);
            if (errors.name && nameKey(v)) setErrors((x) => ({ ...x, name: undefined }));
          }}
        />
      </Field>
      <Field label={t("vendors.form.gstin")} hint={t("vendors.form.gstinHint")} error={errors.gstin}>
        <TextInput
          ref={gstinRef}
          value={gstin}
          maxLength={15}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          className="font-mono uppercase"
          onChangeText={(v) => {
            setGstin(v);
            if (errors.gstin && !gstinProblem(v)) setErrors((x) => ({ ...x, gstin: undefined }));
          }}
        />
      </Field>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <Field label={t("vendors.form.phone")}>
          <TextInput value={phone} maxLength={40} type="tel" inputMode="tel" autoComplete="off" onChangeText={setPhone} />
        </Field>
        <Field label={t("vendors.form.city")}>
          <TextInput value={city} maxLength={80} autoComplete="off" onChangeText={setCity} />
        </Field>
      </div>
      {vendor ? null : (
        <Field label={t("vendors.form.spellings")} hint={t("vendors.form.spellingsHint")}>
          <FieldTextArea value={spellings} rows={3} onChangeText={setSpellings} />
        </Field>
      )}
      <Field label={t("vendors.form.notes")}>
        <FieldTextArea value={notes} rows={2} maxLength={500} onChangeText={setNotes} />
      </Field>
    </MasterSheet>
  );
}
