/**
 * `/billing/settings` (gst.settings): the plant's GST facts the invoice needs beyond the letterhead, the HSN list,
 * and the GST card of any customer. The legal name, GSTIN and address are read from the company's letterhead.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Combobox } from "@orrn/ui/components/combobox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { searchCustomers } from "@/features/dispatch/customer-picker";
import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { HsnSection } from "./hsn-section";
import { orNull } from "./model";
import { PartyGstCard, STATE_OPTIONS } from "./party-card";
import { BillingTabs, errorText } from "./ui";
import { missingWord } from "./new-invoice-page";

const LEDGERS = ["sales", "cgst", "sgst", "igst", "roundOff", "cash", "bank"] as const;
type LedgerKey = (typeof LEDGERS)[number];

export function SettingsPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("bill.settings.title")} subtitle={t("bill.settings.subtitle")} back={{ to: "/billing", label: t("bill.title") }} />
      <BillingTabs current="settings" />
      <Can do="gst.settings" fallback={<EmptyState title={t("bill.settings.noAccess")} />}>
        <PlantForm />
        <HsnSection />
        <PartySection />
      </Can>
    </>
  );
}

function PlantForm() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.billing.settings.get.queryOptions());
  const [stateCode, setStateCode] = useState("");
  const [pincode, setPincode] = useState("");
  const [place, setPlace] = useState("");
  const [tradeName, setTradeName] = useState("");
  const [signatory, setSignatory] = useState("");
  const [terms, setTerms] = useState("");
  const [einvoiceFrom, setEinvoiceFrom] = useState("");
  const [ledgers, setLedgers] = useState<Record<LedgerKey, string>>({ sales: "", cgst: "", sgst: "", igst: "", roundOff: "", cash: "", bank: "" });
  const [tried, setTried] = useState(false);

  useEffect(() => {
    const d = q.data;
    if (!d) return;
    setStateCode(d.stateCode ?? "");
    setPincode(d.pincode ?? "");
    setPlace(d.place ?? "");
    setTradeName(d.tradeName ?? "");
    setSignatory(d.signatory ?? "");
    setTerms(d.terms ?? "");
    setEinvoiceFrom(d.einvoiceFrom ?? "");
    setLedgers({ ...d.tallyLedgers });
  }, [q.data]);

  const save = useMutation({
    ...trpc.billing.settings.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.billing.settings.pathKey() });
      toast.success(t("bill.settings.saved"));
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  if (q.isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (q.isError) {
    return (
      <EmptyState
        title={t("bill.settings.loadError")}
        action={
          <Button variant="secondary" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }
  const d = q.data;
  const pinOk = /^\d{6}$/.test(pincode.trim());
  const dateOk = einvoiceFrom === "" || /^\d{4}-\d{2}-\d{2}$/.test(einvoiceFrom);
  const placeOk = place.trim().length >= 3;

  return (
    <section aria-labelledby="bill-plant" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
      <div>
        <h2 id="bill-plant" className="m-0 text-[15px] font-semibold">
          {t("bill.settings.plant")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("bill.settings.plantHint")}</p>
      </div>
      <dl className="m-0 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("bill.settings.legalName")}</dt>
          <dd className="m-0 font-semibold">{d.legalName ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">GSTIN</dt>
          <dd className="m-0 font-mono font-semibold">{d.gstin ?? "-"}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("bill.settings.address")}</dt>
          <dd className="m-0">{d.address ?? "-"}</dd>
        </div>
      </dl>
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
        <Field label={t("bill.party.state")} hint={t("bill.settings.stateHint")}>
          <Select value={stateCode || "none"} onValueChange={(v) => setStateCode(v === "none" ? "" : v)} options={[{ value: "none", label: t("bill.party.notSet") }, ...STATE_OPTIONS]} placeholder={t("bill.party.state")} />
        </Field>
        <Field label={t("bill.party.pincode")} error={tried && !pinOk ? t("bill.party.pincodeBad") : undefined}>
          <TextInput value={pincode} onChangeText={setPincode} inputMode="numeric" maxLength={6} />
        </Field>
        <Field label={t("bill.party.place")} error={tried && !placeOk ? t("bill.settings.placeBad") : undefined}>
          <TextInput value={place} onChangeText={setPlace} maxLength={100} />
        </Field>
        <Field label={t("bill.settings.tradeName")}>
          <TextInput value={tradeName} onChangeText={setTradeName} maxLength={100} />
        </Field>
        <Field label={t("bill.settings.signatory")}>
          <TextInput value={signatory} onChangeText={setSignatory} maxLength={100} />
        </Field>
        <Field label={t("bill.settings.einvoiceFrom")} hint={t("bill.settings.einvoiceFromHint")} error={tried && !dateOk ? t("bill.settings.dateBad") : undefined}>
          <TextInput type="date" value={einvoiceFrom} onChangeText={setEinvoiceFrom} />
        </Field>
        <Field label={t("bill.settings.terms")} className="sm:col-span-2">
          <TextInput value={terms} onChangeText={setTerms} maxLength={1000} />
        </Field>
      </div>
      <div>
        <h3 className="m-0 text-[14px] font-semibold">{t("bill.settings.ledgers")}</h3>
        <p className="m-0 mb-2 text-[13px] text-muted-foreground">{t("bill.settings.ledgersHint")}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LEDGERS.map((k) => (
            <Field key={k} label={t(`bill.settings.ledger.${k}`)}>
              <TextInput value={ledgers[k]} onChangeText={(v) => setLedgers((p) => ({ ...p, [k]: v }))} maxLength={100} />
            </Field>
          ))}
        </div>
      </div>
      <div>
        <Button
          loading={save.isPending}
          onClick={() => {
            setTried(true);
            if (!stateCode || !pinOk || !placeOk || !dateOk) return;
            save.mutate({ stateCode, pincode: pincode.trim(), place: place.trim(), tradeName: orNull(tradeName), signatory: orNull(signatory), terms: orNull(terms), einvoiceFrom: orNull(einvoiceFrom), tallyLedgers: ledgers });
          }}
        >
          {t("common.save")}
        </Button>
      </div>
    </section>
  );
}

function PartySection() {
  const { t } = useT();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(null);
  return (
    <section aria-labelledby="bill-party" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div>
        <h2 id="bill-party" className="m-0 text-[15px] font-semibold">
          {t("bill.party.title")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("bill.party.hint")}</p>
      </div>
      <Field label={t("bill.payments.customer")}>
        <Combobox<string> value={customer?.id ?? null} valueLabel={customer?.name || undefined} onChange={(id) => setCustomer({ id, name: "" })} search={searchCustomers} placeholder={t("bill.payments.customerSearch")} />
      </Field>
      {customer ? <PartyGstCard key={customer.id} customerId={customer.id} /> : null}
    </section>
  );
}
