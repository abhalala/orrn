/**
 * `/billing/new`: tick the packing lists of one customer, look at the invoice it would make, type a rate per kg
 * where the order has none, add finish, component or packing charges, and save it as a draft. Nothing is
 * issued here: the draft is opened on its own page, where it is issued.
 */
import { kgQtyText } from "@orrn/domain";
import { useT, type Translate } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bookDateText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { chargesFromBoxes, ratesFromBoxes, selectable, type ChargeBox } from "./model";
import { InvoicePreview } from "./preview";
import { BillingTabs, errorText } from "./ui";

const EMPTY_CHARGE: ChargeBox = { label: "", amountText: "", hsnId: "" };

export function NewInvoicePage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("bill.new.title")} subtitle={t("bill.new.subtitle")} back={{ to: "/billing", label: t("bill.title") }} />
      <BillingTabs current="new" />
      <Can do="invoice.issue" fallback={<EmptyState title={t("errors.forbidden")} />}>
        <NewInvoiceForm />
      </Can>
    </>
  );
}

function NewInvoiceForm() {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rateText, setRateText] = useState<Record<string, string>>({});
  const [charges, setCharges] = useState<ChargeBox[]>([]);
  // What the preview was last asked with: changes to the boxes wait for the button.
  const [applied, setApplied] = useState<{ ids: string[]; rates: Record<string, number>; charges: { label: string; amountPaise: number; hsnId?: string }[] } | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const billable = useQuery(trpc.billing.invoices.billable.queryOptions({}));
  const hsn = useQuery(trpc.billing.hsn.list.queryOptions());
  const rows = billable.data ?? [];
  const open = useMemo(() => selectable(rows, picked), [rows, picked]);
  const hsnOptions = (hsn.data ?? []).filter((h) => h.active).map((h) => ({ value: h.id, label: `${h.code} ${h.description}` }));

  const preview = useQuery({
    ...trpc.billing.invoices.preview.queryOptions(applied ? { packingListIds: applied.ids, rates: applied.rates, charges: applied.charges } : { packingListIds: [""] }),
    enabled: applied !== null,
    retry: false,
  });
  const missingRates = preview.data?.missingRates ?? [];
  // Every group that has asked for a rate stays on screen, so a typed rate can still be changed once it is accepted.
  const [groups, setGroups] = useState<{ key: string; label: string }[]>([]);
  useEffect(() => {
    if (missingRates.length === 0) return;
    setGroups((g) => [...g, ...missingRates.filter((m) => !g.some((x) => x.key === m.key))]);
  }, [missingRates]);

  const create = useMutation({
    ...trpc.billing.invoices.createDraft.mutationOptions(),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: trpc.billing.invoices.list.queryKey() });
      await qc.invalidateQueries({ queryKey: trpc.billing.invoices.billable.queryKey() });
      toast.success(t("bill.new.saved"));
      const id = r.id;
      if (id) await navigate({ to: "/billing/$id", params: { id } });
      else await navigate({ to: "/billing" });
    },
    onError: (e) => toast.error(errorText(e, t("errors.generic"))),
  });

  function toggle(id: string, on: boolean) {
    setPicked((p) => {
      const n = new Set(p);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
    setApplied(null);
    setGroups([]);
    setRateText({});
  }

  function ask() {
    const ids = [...picked];
    if (ids.length === 0) return;
    const r = ratesFromBoxes(groups.map((m) => ({ key: m.key, label: m.label, text: rateText[m.key] ?? "" })));
    const c = chargesFromBoxes(charges);
    if (c.bad.length > 0 || r.bad.length > 0) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    setApplied({ ids, rates: r.rates, charges: c.charges });
  }

  const ready = applied !== null && preview.data && preview.data.missing.length === 0 && missingRates.length === 0 && preview.data.snapshot !== null;

  if (billable.isPending) return <Skeleton className="h-48 w-full rounded-card" />;
  if (billable.isError) {
    return (
      <EmptyState
        title={t("bill.new.loadError")}
        action={
          <Button variant="secondary" onClick={() => void billable.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }
  if (rows.length === 0) return <EmptyState title={t("bill.new.none")} body={t("bill.new.noneHint")} />;

  const chargeErrors = showErrors ? chargesFromBoxes(charges).bad : [];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="bill-pick" className="flex min-w-0 flex-col gap-2">
        <h2 id="bill-pick" className="m-0 text-[15px] font-semibold">
          {t("bill.new.pick")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("bill.new.pickHint")}</p>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {rows.map((r) => {
            const on = picked.has(r.id);
            const enabled = open.has(r.id);
            return (
              <li key={r.id} className={`flex min-w-0 items-center gap-3 rounded-card border border-border bg-card px-3 py-2.5 ${enabled ? "" : "opacity-50"}`}>
                <Checkbox id={`pl-${r.id}`} checked={on} disabled={!enabled} onCheckedChange={(v) => toggle(r.id, v === true)} aria-label={t("bill.new.tick", { code: r.code })} />
                <label htmlFor={`pl-${r.id}`} className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-center sm:gap-4">
                  <span className="font-mono font-semibold whitespace-nowrap">{r.code}</span>
                  <span className="min-w-0 flex-1 truncate">{r.customerName}</span>
                  <span className="text-[13px] text-muted-foreground">{r.date ? bookDateText(fmt, r.date) : ""}</span>
                  <span className="font-mono text-[13px] tabular-nums">
                    {r.bundles} {t("bill.new.bundles")} · {kgQtyText(r.weightG)} kg
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      {groups.length > 0 ? (
        <section aria-labelledby="bill-rates" className="flex min-w-0 flex-col gap-2">
          <h2 id="bill-rates" className="m-0 text-[15px] font-semibold">
            {t("bill.new.rates")}
          </h2>
          <p className="m-0 text-[13px] text-muted-foreground">{t("bill.new.ratesHint")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {groups.map((m) => {
              const bad = showErrors && ratesFromBoxes([{ key: m.key, label: m.label, text: rateText[m.key] ?? "" }]).bad.length > 0;
              return (
                <Field key={m.key} label={m.label} error={bad ? t("bill.new.rateBad") : undefined}>
                  <NumberInput value={rateText[m.key] ?? ""} onValueChange={(v) => setRateText((p) => ({ ...p, [m.key]: v }))} suffix={t("bill.new.perKg")} />
                </Field>
              );
            })}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="bill-charges" className="flex min-w-0 flex-col gap-2">
        <h2 id="bill-charges" className="m-0 text-[15px] font-semibold">
          {t("bill.new.charges")}
        </h2>
        <p className="m-0 text-[13px] text-muted-foreground">{t("bill.new.chargesHint")}</p>
        {charges.map((c, i) => (
          <div key={i} className="grid min-w-0 gap-2 rounded-card border border-border bg-card p-3 sm:grid-cols-[1fr_9rem_1fr_auto] sm:items-end">
            <Field label={t("bill.new.chargeLabel")} error={chargeErrors.includes(i) ? t("bill.new.chargeBad") : undefined}>
              <TextInput
                value={c.label}
                placeholder={t("bill.new.chargeExample")}
                onChangeText={(v) => {
                  setCharges((p) => p.map((x, j) => (j === i ? { ...x, label: v } : x)));
                  setApplied(null);
                }}
              />
            </Field>
            <Field label={t("bill.new.chargeAmount")}>
              <NumberInput
                value={c.amountText}
                onValueChange={(v) => {
                  setCharges((p) => p.map((x, j) => (j === i ? { ...x, amountText: v } : x)));
                  setApplied(null);
                }}
              />
            </Field>
            <Field label={t("bill.new.chargeHsn")}>
              <Select
                value={c.hsnId || "default"}
                onValueChange={(v) => {
                  setCharges((p) => p.map((x, j) => (j === i ? { ...x, hsnId: v === "default" ? "" : v } : x)));
                  setApplied(null);
                }}
                options={[{ value: "default", label: t("bill.new.hsnDefault") }, ...hsnOptions]}
                placeholder={t("bill.new.hsnDefault")}
              />
            </Field>
            <Button
              variant="ghost"
              aria-label={t("common.remove")}
              onClick={() => {
                setCharges((p) => p.filter((_, j) => j !== i));
                setApplied(null);
              }}
            >
              <X aria-hidden="true" strokeWidth={2} />
            </Button>
          </div>
        ))}
        {charges.length < 10 ? (
          <div>
            <Button variant="secondary" onClick={() => setCharges((p) => [...p, EMPTY_CHARGE])}>
              <Plus aria-hidden="true" strokeWidth={2} />
              {t("bill.new.addCharge")}
            </Button>
          </div>
        ) : null}
      </section>

      <div className="flex flex-wrap gap-2">
        <Button onClick={ask} disabled={picked.size === 0} loading={preview.isFetching}>
          {applied ? t("bill.new.refresh") : t("bill.new.show")}
        </Button>
      </div>

      {applied && preview.isError ? (
        <div role="alert" className="rounded-card border border-border bg-card p-4 text-[14px]">
          {errorText(preview.error, t("errors.generic"))}
        </div>
      ) : null}

      {preview.data ? (
        <>
          {preview.data.missing.length > 0 ? (
            <div role="alert" className="flex flex-col gap-2 rounded-card border border-border bg-card p-4">
              <p className="m-0 font-semibold">{t("bill.new.missing")}</p>
              <ul className="m-0 list-disc pl-5 text-[14px]">
                {[...new Set(preview.data.missing)].map((m) => (
                  <li key={m}>{missingWord(t, m)}</li>
                ))}
              </ul>
              <Button asChild variant="secondary" className="self-start">
                <Link to="/billing/settings">{t("bill.new.openSettings")}</Link>
              </Button>
            </div>
          ) : null}
          {preview.data.snapshot ? <InvoicePreview snapshot={preview.data.snapshot} /> : missingRates.length > 0 ? <p className="m-0 text-[14px] text-muted-foreground">{t("bill.new.ratesFirst")}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!ready}
              loading={create.isPending}
              onClick={() => applied && create.mutate({ packingListIds: applied.ids, rates: applied.rates, charges: applied.charges })}
            >
              {t("bill.new.save")}
            </Button>
          </div>
        </>
      ) : applied && preview.isFetching ? (
        <Skeleton className="h-40 w-full rounded-card" />
      ) : null}
    </div>
  );
}

/** What a missing fact is called: one of our words, else the code as it came. */
export function missingWord(t: Translate, code: string): string {
  const keys = ["plant_gstin", "plant_legal_name", "plant_address", "plant_state", "plant_pincode", "plant_place", "customer", "party_gstin", "party_state", "party_pincode", "party_place", "party_address", "ship_to", "hsn"];
  return keys.includes(code) ? t(`bill.missing.${code}` as Parameters<Translate>[0]) : code;
}
