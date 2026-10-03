import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox, type ComboboxOption } from "@orrn/ui/components/combobox";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { UserPlus } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc, trpcClient } from "@/shared/utils/trpc";

export type PickedCustomer = { id: string; name: string };

/** Customers of the most recent dispatches, newest first, each once (the "recent first" list). */
export function useRecentCustomers(): ComboboxOption<string>[] {
  const recent = useQuery(trpc.dispatch.listDispatches.queryOptions({ limit: 30 }));
  return useMemo(() => {
    const seen = new Set<string>();
    const out: ComboboxOption<string>[] = [];
    for (const d of recent.data?.items ?? []) {
      if (seen.has(d.customerId)) continue;
      seen.add(d.customerId);
      out.push({ value: d.customerId, label: d.customerName });
      if (out.length === 6) break;
    }
    return out;
  }, [recent.data]);
}

export async function searchCustomers(q: string): Promise<ComboboxOption<string>[]> {
  const res = await trpcClient.customer.list.query({ search: q, limit: 20 });
  return res.items.map((c) => ({ value: c.id, label: c.name, hint: c.phone ?? undefined }));
}

type Props = {
  value: PickedCustomer | null;
  onChange(next: PickedCustomer): void;
  error?: string;
  /** Offer "New customer" (inline sheet). */
  allowNew?: boolean;
};

/** Customer field: searchable, recent customers first, with an inline "New customer" sheet. */
export function CustomerPicker({ value, onChange, error, allowNew = true }: Props) {
  const { t } = useT();
  const recent = useRecentCustomers();
  const [creating, setCreating] = useState(false);
  const labels = useMemo(() => new Map(recent.map((r) => [r.value, r.label])), [recent]);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Field label={t("dispatch.new.customer")} hint={t("dispatch.new.customerHint")} error={error}>
        <Combobox<string>
          value={value?.id ?? null}
          valueLabel={value?.name}
          onChange={(id) => onChange({ id, name: labels.get(id) ?? lastLabels.get(id) ?? "" })}
          search={async (q) => {
            const found = await searchCustomers(q);
            for (const f of found) lastLabels.set(f.value, f.label);
            return found;
          }}
          recent={recent}
          placeholder={t("dispatch.new.customerSearch")}
        />
      </Field>
      {allowNew ? (
        <Can do="customer.create">
          <Button variant="ghost" className="self-start px-3" onClick={() => setCreating(true)} aria-haspopup="dialog">
            <UserPlus aria-hidden="true" strokeWidth={2} />
            {t("dispatch.new.newCustomer")}
          </Button>
          <NewCustomerSheet
            open={creating}
            onOpenChange={setCreating}
            onCreated={(c) => {
              setCreating(false);
              onChange(c);
            }}
          />
        </Can>
      ) : null}
    </div>
  );
}

/** Labels of searched customers, so a pick shows its name even before the list refetches. */
const lastLabels = new Map<string, string>();

function NewCustomerSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated(c: PickedCustomer): void;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | undefined>();
  const create = useMutation(trpc.customer.create.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t("errors.required"));
      return;
    }
    create.mutate(
      { name: trimmed, phone: phone.trim() || null },
      {
        onSuccess: (res) => {
          toast.success(t("dispatch.new.customerAdded", { name: trimmed }));
          lastLabels.set(res.id, trimmed);
          setName("");
          setPhone("");
          setError(undefined);
          onCreated({ id: res.id, name: trimmed });
        },
        onError: (err) => setError(err.message || t("errors.generic")),
      },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("dispatch.new.newCustomer")}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" form="new-customer-form" loading={create.isPending}>
            {t("dispatch.new.addCustomer")}
          </Button>
        </>
      }
    >
      <form id="new-customer-form" onSubmit={submit} className="flex flex-col gap-4 pt-1" noValidate>
        <Field label={t("dispatch.new.customerName")} error={error}>
          <TextInput value={name} onChangeText={setName} autoComplete="organization" autoFocus required />
        </Field>
        <Field label={`${t("dispatch.new.customerPhone")} (${t("common.optional").toLowerCase()})`}>
          <TextInput value={phone} onChangeText={setPhone} type="tel" inputMode="tel" autoComplete="tel" />
        </Field>
      </form>
    </Sheet>
  );
}
