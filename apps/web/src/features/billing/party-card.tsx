/** The GST card of one customer: tax category, state, place of supply, where the goods go and the e-way bill distance. */
import { GST_STATE_CODES, GST_TAX_CATEGORIES, type TaxCategory } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox } from "@orrn/ui/components/combobox";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { searchCustomers } from "@/features/dispatch/customer-picker";
import { trpc } from "@/shared/utils/trpc";

import { orNull } from "./model";
import { errorText } from "./ui";
import { missingWord } from "./new-invoice-page";

export const STATE_OPTIONS = Object.entries(GST_STATE_CODES)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([code, name]) => ({ value: code, label: `${name} (${code})` }));

const NONE = "none";
type ShipKind = "same" | "party" | "address";

type Form = {
  taxCategory: TaxCategory;
  stateCode: string;
  pincode: string;
  place: string;
  placeOfSupply: string;
  shipToKind: ShipKind;
  shipToCustomerId: string;
  shipToCustomerName: string;
  shipToName: string;
  shipToGstin: string;
  shipToAddress: string;
  shipToPlace: string;
  shipToStateCode: string;
  shipToPincode: string;
  distanceKm: string;
};

export function PartyGstCard({ customerId }: { customerId: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.billing.party.get.queryOptions({ customerId }));
  const [f, setF] = useState<Form | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const d = q.data;
    if (!d) return;
    setF({
      taxCategory: d.taxCategory as TaxCategory,
      stateCode: d.stateCode ?? "",
      pincode: d.pincode ?? "",
      place: d.place ?? "",
      placeOfSupply: d.placeOfSupply ?? "",
      shipToKind: d.shipToKind as ShipKind,
      shipToCustomerId: d.shipToCustomerId ?? "",
      shipToCustomerName: "",
      shipToName: d.shipToName ?? "",
      shipToGstin: d.shipToGstin ?? "",
      shipToAddress: d.shipToAddress ?? "",
      shipToPlace: d.shipToPlace ?? "",
      shipToStateCode: d.shipToStateCode ?? "",
      shipToPincode: d.shipToPincode ?? "",
      distanceKm: d.distanceKm == null ? "" : String(d.distanceKm),
    });
    setTried(false);
  }, [q.data]);

  const save = useMutation({
    ...trpc.billing.party.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.billing.party.pathKey() });
      toast.success(t("bill.party.saved"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  if (q.isPending || !f) return <Skeleton className="h-48 w-full rounded-card" />;
  if (q.isError) {
    return (
      <Button variant="secondary" onClick={() => void q.refetch()}>
        {t("common.retry")}
      </Button>
    );
  }
  const d = q.data;
  const set = (patch: Partial<Form>) => setF((p) => (p ? { ...p, ...patch } : p));
  const km = f.distanceKm.trim() === "" ? null : /^\d{1,4}$/.test(f.distanceKm.trim()) ? Number(f.distanceKm) : undefined;
  const pincodeBad = (v: string) => v.trim() !== "" && !/^\d{6}$/.test(v.trim());

  function submit() {
    setTried(true);
    if (!f || km === undefined || pincodeBad(f.pincode) || pincodeBad(f.shipToPincode)) return;
    save.mutate({
      customerId,
      taxCategory: f.taxCategory,
      stateCode: orNull(f.stateCode),
      pincode: orNull(f.pincode),
      place: orNull(f.place),
      placeOfSupply: orNull(f.placeOfSupply),
      shipToKind: f.shipToKind,
      shipToCustomerId: f.shipToKind === "party" ? orNull(f.shipToCustomerId) : null,
      shipToName: orNull(f.shipToName),
      shipToGstin: orNull(f.shipToGstin),
      shipToAddress: orNull(f.shipToAddress),
      shipToPlace: orNull(f.shipToPlace),
      shipToStateCode: orNull(f.shipToStateCode),
      shipToPincode: orNull(f.shipToPincode),
      distanceKm: km,
    });
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
      <div>
        <p className="m-0 font-semibold">{d.name}</p>
        <p className="m-0 font-mono text-[13px]">{d.gstin ?? t("bill.party.noGstin")}</p>
        <p className="m-0 text-[12px] text-muted-foreground">{t("bill.party.gstinHint")}</p>
      </div>
      {d.missing.length > 0 ? (
        <div role="alert" className="rounded-card border border-border bg-surface-sunken p-3 text-[13px]">
          <p className="m-0 font-semibold">{t("bill.new.missing")}</p>
          <ul className="m-0 list-disc pl-5">
            {[...new Set(d.missing)].map((m) => (
              <li key={m}>{missingWord(t, m)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("bill.party.category")}>
          <Select value={f.taxCategory} onValueChange={(v) => set({ taxCategory: v as TaxCategory })} options={GST_TAX_CATEGORIES.map((c) => ({ value: c, label: t(`bill.party.categories.${c}`) }))} placeholder={t("bill.party.category")} />
        </Field>
        <Field label={t("bill.party.state")}>
          <Select value={f.stateCode || NONE} onValueChange={(v) => set({ stateCode: v === NONE ? "" : v })} options={[{ value: NONE, label: t("bill.party.notSet") }, ...STATE_OPTIONS]} placeholder={t("bill.party.state")} />
        </Field>
        <Field label={t("bill.party.pincode")} error={tried && pincodeBad(f.pincode) ? t("bill.party.pincodeBad") : undefined}>
          <TextInput value={f.pincode} onChangeText={(v) => set({ pincode: v })} inputMode="numeric" maxLength={6} />
        </Field>
        <Field label={t("bill.party.place")}>
          <TextInput value={f.place} onChangeText={(v) => set({ place: v })} maxLength={100} />
        </Field>
        <Field label={t("bill.party.placeOfSupply")} hint={t("bill.party.placeOfSupplyHint")}>
          <Select value={f.placeOfSupply || NONE} onValueChange={(v) => set({ placeOfSupply: v === NONE ? "" : v })} options={[{ value: NONE, label: t("bill.party.sameAsState") }, ...STATE_OPTIONS]} placeholder={t("bill.party.placeOfSupply")} />
        </Field>
        <Field label={t("bill.party.distance")} hint={t("bill.party.distanceHint")} error={tried && km === undefined ? t("bill.ewb.distanceBad") : undefined}>
          <NumberInput value={f.distanceKm} onValueChange={(v) => set({ distanceKm: v })} decimal={false} suffix="km" />
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <SegmentedControl
          label={t("bill.party.shipTo")}
          value={f.shipToKind}
          onChange={(k) => set({ shipToKind: k })}
          options={[
            { value: "same" as ShipKind, label: t("bill.party.shipSame") },
            { value: "party" as ShipKind, label: t("bill.party.shipParty") },
            { value: "address" as ShipKind, label: t("bill.party.shipAddress") },
          ]}
        />
        {f.shipToKind === "party" ? (
          <Field label={t("bill.party.shipPartyPick")}>
            <Combobox<string>
              value={f.shipToCustomerId || null}
              valueLabel={f.shipToCustomerName || undefined}
              onChange={(id) => set({ shipToCustomerId: id })}
              search={async (qq) => (await searchCustomers(qq)).filter((o) => o.value !== customerId)}
              placeholder={t("bill.payments.customerSearch")}
            />
          </Field>
        ) : null}
        {f.shipToKind === "address" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("bill.party.shipName")}>
              <TextInput value={f.shipToName} onChangeText={(v) => set({ shipToName: v })} maxLength={100} />
            </Field>
            <Field label="GSTIN">
              <TextInput value={f.shipToGstin} onChangeText={(v) => set({ shipToGstin: v.toUpperCase() })} maxLength={15} />
            </Field>
            <Field label={t("bill.party.shipAddressLine")} className="sm:col-span-2">
              <TextInput value={f.shipToAddress} onChangeText={(v) => set({ shipToAddress: v })} maxLength={200} />
            </Field>
            <Field label={t("bill.party.place")}>
              <TextInput value={f.shipToPlace} onChangeText={(v) => set({ shipToPlace: v })} maxLength={100} />
            </Field>
            <Field label={t("bill.party.state")}>
              <Select value={f.shipToStateCode || NONE} onValueChange={(v) => set({ shipToStateCode: v === NONE ? "" : v })} options={[{ value: NONE, label: t("bill.party.notSet") }, ...STATE_OPTIONS]} placeholder={t("bill.party.state")} />
            </Field>
            <Field label={t("bill.party.pincode")} error={tried && pincodeBad(f.shipToPincode) ? t("bill.party.pincodeBad") : undefined}>
              <TextInput value={f.shipToPincode} onChangeText={(v) => set({ shipToPincode: v })} inputMode="numeric" maxLength={6} />
            </Field>
          </div>
        ) : null}
      </div>

      <Can do="gst.settings">
        <div>
          <Button loading={save.isPending} onClick={submit}>
            {t("bill.party.save")}
          </Button>
        </div>
      </Can>
    </div>
  );
}
