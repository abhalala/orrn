/**
 * Customer form (plan Task 23): name, phone, email, GSTIN, notes, and the billing and shipping
 * addresses the server already accepts. "Same as billing address" copies billing into shipping on
 * save. Used full page for a new customer and in the edit sheet on a customer's page; the submit
 * button lives with the caller and targets the form by `formId`.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { trpc } from "@/shared/utils/trpc";

import { addressToDraft, draftToAddress, EMPTY_ADDRESS, gstinField, sameDraft, type AddressDraft } from "./address";

export type StoredCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  taxId: string | null;
  notes: string | null;
  billingAddress: Record<string, unknown> | null;
  shippingAddress: Record<string, unknown> | null;
};

type Draft = {
  name: string;
  phone: string;
  email: string;
  gstin: string;
  notes: string;
  billing: AddressDraft;
  shipping: AddressDraft;
  sameAsBilling: boolean;
};

type Errors = Partial<Record<"name" | "email" | "gstin", MessageKey>>;

function toDraft(c?: StoredCustomer): Draft {
  const billing = addressToDraft(c?.billingAddress);
  const shipping = addressToDraft(c?.shippingAddress);
  const shippingEmpty = sameDraft(shipping, EMPTY_ADDRESS);
  return {
    name: c?.name ?? "",
    phone: c?.phone ?? "",
    email: c?.email ?? "",
    gstin: c?.taxId ?? "",
    notes: c?.notes ?? "",
    billing,
    shipping,
    sameAsBilling: !c || shippingEmpty || sameDraft(billing, shipping),
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(d: Draft, storedGstin: string | null): Errors {
  const errors: Errors = {};
  if (!d.name.trim()) errors.name = "errors.required";
  if (d.email.trim() && !EMAIL.test(d.email.trim())) errors.email = "errors.invalidEmail";
  const gstin = gstinField(d.gstin, storedGstin);
  if (gstin.error) errors.gstin = gstin.error;
  return errors;
}

export type CustomerFormProps = {
  formId: string;
  customer?: StoredCustomer;
  onSaved(id: string): void;
  onPendingChange?(pending: boolean): void;
};

export function CustomerForm({ formId, customer, onSaved, onPendingChange }: CustomerFormProps) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(customer));
  const [errors, setErrors] = useState<Errors>({});
  const [announce, setAnnounce] = useState("");
  const storedGstin = customer?.taxId ?? null;
  // An imported partial GSTIN the person has not touched is flagged, never a reason to refuse the save.
  const gstinWarning = gstinField(draft.gstin, storedGstin).warning;

  const onSuccess = async (id: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.customer.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.customer.get.queryKey({ id }) }),
    ]);
    toast.success(t("customers.form.saved"));
    onSaved(id);
  };
  const onError = (error: { data?: { code?: string } | null }) => {
    toast.error(error.data?.code === "FORBIDDEN" ? t("errors.forbidden") : t("errors.generic"));
  };

  const create = useMutation({ ...trpc.customer.create.mutationOptions(), onSuccess: (r) => onSuccess(r.id), onError });
  const update = useMutation({ ...trpc.customer.update.mutationOptions(), onSuccess: () => onSuccess(customer!.id), onError });
  const pending = create.isPending || update.isPending;
  useEffect(() => onPendingChange?.(pending), [pending, onPendingChange]);

  const setText = (field: "name" | "phone" | "email" | "gstin" | "notes") => (value: string) => {
    setDraft((d) => ({ ...d, [field]: value }));
    if (field in errors) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  const setAddress = (which: "billing" | "shipping") => (next: AddressDraft) => setDraft((d) => ({ ...d, [which]: next }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const found = validate(draft, storedGstin);
    setErrors(found);
    const first = (["name", "email", "gstin"] as const).find((k) => found[k]);
    if (first) {
      setAnnounce(t("customers.form.fixErrors"));
      requestAnimationFrame(() => document.getElementById(`${formId}-${first}`)?.focus());
      return;
    }
    setAnnounce("");
    const billingAddress = draftToAddress(draft.billing, customer?.billingAddress);
    const shippingAddress = draft.sameAsBilling
      ? draftToAddress(draft.billing, customer?.shippingAddress ?? customer?.billingAddress)
      : draftToAddress(draft.shipping, customer?.shippingAddress);
    const input = {
      name: draft.name.trim(),
      phone: draft.phone.trim() || null,
      email: draft.email.trim() || null,
      taxId: gstinField(draft.gstin, storedGstin).value,
      notes: draft.notes.trim() || null,
      billingAddress,
      shippingAddress,
    };
    if (customer) update.mutate({ id: customer.id, ...input });
    else create.mutate(input);
  };

  const err = (field: keyof Errors) => (errors[field] ? t(errors[field]!) : undefined);

  return (
    <form id={formId} noValidate onSubmit={submit} className="@container flex flex-col gap-6" aria-busy={pending || undefined}>
      <p aria-live="polite" className="sr-only">
        {announce}
      </p>
      <div className="flex flex-col gap-4">
        <Field label={t("customers.form.name")} hint={t("customers.form.nameHint")} error={err("name")} id={`${formId}-name`}>
          <TextInput value={draft.name} onChangeText={setText("name")} autoComplete="organization" maxLength={500} required />
        </Field>
        <div className="grid grid-cols-1 gap-4 @lg:grid-cols-2">
          <Field label={t("customers.form.phone")} id={`${formId}-phone`}>
            <TextInput type="tel" value={draft.phone} onChangeText={setText("phone")} autoComplete="tel" maxLength={500} />
          </Field>
          <Field label={t("customers.form.email")} error={err("email")} id={`${formId}-email`}>
            <TextInput
              type="email"
              value={draft.email}
              onChangeText={setText("email")}
              autoComplete="email"
              autoCapitalize="none"
              maxLength={500}
            />
          </Field>
        </div>
        <Field
          label={t("customers.form.gstin")}
          hint={t(gstinWarning ?? "customers.form.gstinHint")}
          error={err("gstin")}
          id={`${formId}-gstin`}
        >
          <TextInput
            value={draft.gstin}
            onChangeText={setText("gstin")}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={20}
            className="font-mono uppercase @lg:max-w-[320px]"
          />
        </Field>
      </div>

      <AddressFields
        idPrefix={`${formId}-billing`}
        legend={t("customers.form.billingAddress")}
        value={draft.billing}
        onChange={setAddress("billing")}
      />

      <label className="-my-1 flex min-h-11 cursor-pointer items-center gap-3 self-start text-[15px] font-medium">
        <input
          type="checkbox"
          checked={draft.sameAsBilling}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            setDraft((d) => ({
              ...d,
              sameAsBilling: checked,
              // Unticking starts the shipping address from the billing one: usually only a line differs.
              shipping: !checked && sameDraft(d.shipping, EMPTY_ADDRESS) ? d.billing : d.shipping,
            }));
          }}
          className="size-5 shrink-0 cursor-pointer accent-primary"
        />
        {t("customers.form.sameAsBilling")}
      </label>

      {!draft.sameAsBilling ? (
        <AddressFields
          idPrefix={`${formId}-shipping`}
          legend={t("customers.form.shippingAddress")}
          value={draft.shipping}
          onChange={setAddress("shipping")}
        />
      ) : null}

      <Field label={t("customers.form.notes")} id={`${formId}-notes`}>
        <FieldTextArea value={draft.notes} onChangeText={setText("notes")} rows={3} maxLength={500} />
      </Field>
    </form>
  );
}

function AddressFields({
  idPrefix,
  legend,
  value,
  onChange,
}: {
  idPrefix: string;
  legend: string;
  value: AddressDraft;
  onChange(next: AddressDraft): void;
}) {
  const { t } = useT();
  const set = (key: keyof AddressDraft) => (text: string) => onChange({ ...value, [key]: text });
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-4 border-0 border-t border-border p-0 pt-5">
      <legend className="float-left mb-1 w-full p-0 text-[17px] leading-6 font-semibold tracking-[-0.01em]">{legend}</legend>
      <Field label={t("customers.form.addressLine")} id={`${idPrefix}-line1`}>
        <TextInput value={value.line1} onChangeText={set("line1")} autoComplete="address-line1" maxLength={200} />
      </Field>
      <Field label={t("customers.form.addressLine2")} id={`${idPrefix}-line2`}>
        <TextInput value={value.line2} onChangeText={set("line2")} autoComplete="address-line2" maxLength={200} />
      </Field>
      <div className="grid grid-cols-2 gap-3 @lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,9rem)] @lg:gap-4">
        <Field label={t("customers.form.city")} id={`${idPrefix}-city`}>
          <TextInput value={value.city} onChangeText={set("city")} autoComplete="address-level2" maxLength={100} />
        </Field>
        <Field label={t("customers.form.state")} id={`${idPrefix}-state`}>
          <TextInput value={value.state} onChangeText={set("state")} autoComplete="address-level1" maxLength={100} />
        </Field>
        <Field label={t("customers.form.pincode")} id={`${idPrefix}-postalCode`} className="col-span-2 @lg:col-span-1">
          <TextInput
            value={value.postalCode}
            onChangeText={set("postalCode")}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            className="font-mono"
          />
        </Field>
      </div>
    </fieldset>
  );
}
