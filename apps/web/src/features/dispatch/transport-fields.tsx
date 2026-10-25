import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { dispatchErrorText } from "./errors";
import { parseCapacityKg, type TransportFields } from "./transport";

/** Which of the fields to show: the new form asks for the transporter and capacity only. */
export type TransportShow = { vehicle?: boolean; driver?: boolean; capacity?: boolean; invoice?: boolean };

/**
 * Transport details of a dispatch: the transporter (a master the plant keeps), the truck's capacity,
 * and on the edit sheet the vehicle, driver and Tally invoice. Whoever may publish masters can add a
 * transporter right here; everyone else picks from the list.
 */
export function TransportFieldset({
  value,
  onChange,
  show,
  capacityError,
  capacityLocked = false,
}: {
  value: TransportFields;
  onChange(next: TransportFields): void;
  show: TransportShow;
  capacityError?: string;
  /** After completion the capacity the load went against does not change. */
  capacityLocked?: boolean;
}) {
  const { t } = useT();
  const set = (patch: Partial<TransportFields>) => onChange({ ...value, ...patch });
  return (
    <div data-slot="transport-fields" className="flex min-w-0 flex-col gap-5">
      <TransporterPicker value={value.transporterId} onChange={(transporterId) => set({ transporterId })} />
      {show.capacity ? (
        <Field
          label={t("dispatch.capacity.label")}
          hint={capacityLocked ? t("dispatch.capacity.locked") : t("dispatch.capacity.hint")}
          error={capacityError}
          className="sm:max-w-[260px]"
        >
          <NumberInput
            value={value.capacityKg}
            onValueChange={(capacityKg) => set({ capacityKg })}
            suffix={t("units.kg")}
            disabled={capacityLocked}
            enterKeyHint="next"
          />
        </Field>
      ) : null}
      {show.vehicle ? (
        <Field label={t("dispatch.header.vehicleNo")} hint={t("dispatch.header.vehicleHint")} className="sm:max-w-[260px]">
          <TextInput
            value={value.vehicleNo}
            onChangeText={(vehicleNo) => set({ vehicleNo })}
            maxLength={30}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </Field>
      ) : null}
      {show.driver ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={t("dispatch.header.driverName")}>
            <TextInput value={value.driverName} onChangeText={(driverName) => set({ driverName })} maxLength={100} autoComplete="off" />
          </Field>
          <Field label={t("dispatch.header.driverPhone")}>
            <TextInput
              type="tel"
              value={value.driverPhone}
              onChangeText={(driverPhone) => set({ driverPhone })}
              maxLength={20}
              autoComplete="off"
              inputMode="tel"
            />
          </Field>
        </div>
      ) : null}
      {show.invoice ? (
        <Can do="invoice.link">
          <div className="grid gap-5 sm:grid-cols-2">
            <Field label={t("dispatch.header.invoiceNumber")}>
              <TextInput
                value={value.invoiceNumber}
                onChangeText={(invoiceNumber) => set({ invoiceNumber })}
                maxLength={50}
                autoComplete="off"
                className="font-mono"
              />
            </Field>
            <Field label={t("dispatch.header.invoiceDate")}>
              <TextInput type="date" value={value.invoiceDate} onChangeText={(invoiceDate) => set({ invoiceDate })} />
            </Field>
          </div>
        </Can>
      ) : null}
    </div>
  );
}

/** Capacity error text for the field, or undefined when it is blank or a valid weight. */
export function capacityErrorText(t: ReturnType<typeof useT>["t"], text: string): string | undefined {
  return parseCapacityKg(text) === undefined ? t("dispatch.capacity.invalid") : undefined;
}

function TransporterPicker({ value, onChange }: { value: string; onChange(id: string): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const list = useQuery({ ...trpc.transporter.list.queryOptions(), staleTime: 60_000 });
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const create = useMutation(trpc.transporter.create.mutationOptions());
  const items = list.data?.items ?? [];
  // A transporter retired since the dispatch picked it still shows (by id) until another is chosen.

  const add = () => {
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { name: n, phone: phone.trim() || undefined },
      {
        onSuccess: async (res) => {
          await queryClient.invalidateQueries({ queryKey: trpc.transporter.list.queryKey() });
          onChange(res.id);
          setAdding(false);
          setName("");
          setPhone("");
          toast.success(t("dispatch.transporter.added", { name: n }));
        },
        onError: (err) => toast.error(dispatchErrorText(t, err)),
      },
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-2 sm:max-w-[360px]">
      <Field label={t("dispatch.transporter.label")} id="transporter-select">
        <NativeSelect id="transporter-select" value={value} onChange={(e) => onChange(e.currentTarget.value)} data-testid="transporter-select">
          <option value="">{t("dispatch.transporter.none")}</option>
          {items.map((tr) => (
            <option key={tr.id} value={tr.id}>
              {tr.name}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Can do="masters.publish">
        {adding ? (
          <div className="flex flex-col gap-2 rounded-input bg-surface-sunken p-3">
            <Field label={t("dispatch.transporter.name")}>
              <TextInput value={name} onChangeText={setName} maxLength={120} autoComplete="off" />
            </Field>
            <Field label={t("dispatch.transporter.phone")}>
              <TextInput type="tel" value={phone} onChangeText={setPhone} maxLength={20} autoComplete="off" inputMode="tel" />
            </Field>
            <div className="flex gap-2">
              <Button onClick={add} loading={create.isPending} disabled={name.trim() === ""}>
                {t("dispatch.transporter.save")}
              </Button>
              <Button variant="ghost" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" className="self-start" onClick={() => setAdding(true)}>
            {t("dispatch.transporter.add")}
          </Button>
        )}
      </Can>
    </div>
  );
}
