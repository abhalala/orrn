/**
 * `/payroll/settings`: the statutory rates (EPF, ESIC, professional tax, bonus, gratuity), dated by month. The defaults
 * ship with the server's source note and are shown as defaults to confirm with the CA; saving needs a note that says
 * where the saved figures come from.
 */
import { DEFAULT_STATUTORY_RATES, type StatutoryRates } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { bpText, monthName, rs } from "./explain";
import { ratesInForce, ratesInput, ratesToForm, type RatesForm } from "./model";
import { PayrollGate, PayrollTabs, errorText, useToday } from "./ui";

export function SettingsPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("payroll.settings.title")} subtitle={t("payroll.settings.subtitle")} />
      <PayrollTabs current="settings" />
      <PayrollGate>
        <Settings />
      </PayrollGate>
    </>
  );
}

type Text = keyof Omit<RatesForm, "slabs">;
const MONEY: { key: Text; label: MessageKey }[] = [
  { key: "epfCeiling", label: "payroll.settings.epfCeiling" },
  { key: "esicCeiling", label: "payroll.settings.esicCeiling" },
  { key: "esicExempt", label: "payroll.settings.esicExempt" },
  { key: "bonusEligible", label: "payroll.settings.bonusEligible" },
  { key: "bonusCalc", label: "payroll.settings.bonusCalc" },
  { key: "gratuityCeiling", label: "payroll.settings.gratuityCeiling" },
];
const PERCENT: { key: Text; label: MessageKey }[] = [
  { key: "epfEmployee", label: "payroll.settings.epfEmployee" },
  { key: "epsEmployer", label: "payroll.settings.epsEmployer" },
  { key: "edli", label: "payroll.settings.edli" },
  { key: "epfAdmin", label: "payroll.settings.epfAdmin" },
  { key: "esicEmployee", label: "payroll.settings.esicEmployee" },
  { key: "esicEmployer", label: "payroll.settings.esicEmployer" },
  { key: "bonusMin", label: "payroll.settings.bonusMin" },
  { key: "bonusMax", label: "payroll.settings.bonusMax" },
];
const WHOLE: { key: Text; label: MessageKey }[] = [
  { key: "epsMaxAge", label: "payroll.settings.epsMaxAge" },
  { key: "gratuityMin", label: "payroll.settings.gratuityMin" },
];

/** A few headline figures, so a saved row can be read without opening the form. */
function headline(t: ReturnType<typeof useT>["t"], v: StatutoryRates): string {
  return `${t("payroll.settings.epfEmployee")} ${bpText(v.epfEmployeeBp)}, ${t("payroll.settings.epfCeiling")} ${rs(v.epfWageCeilingPaise)}, ${t("payroll.settings.esicCeiling")} ${rs(v.esicWageCeilingPaise)}`;
}

function Settings() {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const month = today.slice(0, 7);
  const q = useQuery(trpc.payroll.settings.get.queryOptions());
  const [form, setForm] = useState<RatesForm>(() => ratesToForm(DEFAULT_STATUTORY_RATES, month));
  const [tried, setTried] = useState(false);
  const started = useRef(false);

  // Start from the rates in force this month once they are read (the defaults when none is saved).
  useEffect(() => {
    if (!q.data || started.current) return;
    started.current = true;
    const inForce = ratesInForce(q.data.statutory, month);
    if (inForce) setForm(ratesToForm({ ...DEFAULT_STATUTORY_RATES, ...inForce.value }, month));
  }, [q.data, month]);

  const save = useMutation({
    ...trpc.payroll.settings.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.payroll.settings.pathKey() });
      toast.success(t("payroll.settings.saved"));
      setTried(false);
    },
    onError: (e) => toast.error(errorText(e, t("payroll.loadError"))),
  });

  if (q.isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (q.isError || !q.data) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("payroll.loadError")}
          action={
            <Button variant="secondary" onClick={() => void q.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  const { statutory, defaults, defaultNote } = q.data;
  const inForce = ratesInForce(statutory, month);
  const checked = ratesInput(form);
  const err = tried && !checked.ok ? t(`payroll.settings.${checked.error}` as MessageKey) : undefined;
  const set = (key: Text, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const setSlab = (i: number, key: "from" | "tax", value: string) => setForm((f) => ({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, [key]: value } : s)) }));

  return (
    <>
      <section aria-labelledby="pay-defaults" className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4">
        <h2 id="pay-defaults" className="m-0 text-[15px] font-semibold">
          {t("payroll.settings.defaultsTitle")}
        </h2>
        <p role="note" className="m-0 text-[13px] font-medium text-destructive">
          {t("payroll.settings.defaultsHint")}
        </p>
        <p className="m-0 text-[13px] text-muted-foreground">{headline(t, defaults)}</p>
        <h3 className="m-0 mt-2 text-[13px] font-semibold">{t("payroll.settings.sourceTitle")}</h3>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">{defaultNote}</p>
        <p className="m-0 text-[13px]">{inForce ? t("payroll.settings.inForce", { month: monthName(t, inForce.effectiveFrom) }) : t("payroll.settings.inForceNone")}</p>
      </section>

      {statutory.length > 0 ? (
        <section aria-labelledby="pay-saved" className="flex min-w-0 flex-col gap-2">
          <h2 id="pay-saved" className="m-0 text-[15px] font-semibold">
            {t("payroll.settings.historyTitle")}
          </h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {statutory.map((row) => {
              const v = { ...DEFAULT_STATUTORY_RATES, ...(row.value as unknown as Partial<StatutoryRates>) };
              return (
                <li key={row.id} className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="m-0 text-[14px] font-medium">{t("payroll.settings.inForce", { month: monthName(t, row.effectiveFrom) })}</p>
                    <p className="m-0 text-[13px] text-muted-foreground">{headline(t, v)}</p>
                    {row.note ? <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.settings.historyNote", { note: row.note })}</p> : null}
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setForm(ratesToForm(v, month, row.note ?? ""))}>
                    {t("payroll.settings.fromLatest")}
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <Can do="payroll.run">
        <section aria-labelledby="pay-rates-form" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pay-rates-form" className="m-0 text-[15px] font-semibold">
              {t("payroll.settings.formTitle")}
            </h2>
            <Button variant="secondary" size="sm" onClick={() => setForm(ratesToForm(DEFAULT_STATUTORY_RATES, form.effectiveFrom, form.note))}>
              {t("payroll.settings.fromDefaults")}
            </Button>
          </div>
          <Field label={t("payroll.settings.effectiveFrom")} required hint="2026-11" className="sm:w-56">
            <TextInput value={form.effectiveFrom} onChangeText={(v) => set("effectiveFrom", v)} maxLength={7} inputMode="numeric" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PERCENT.map((f) => (
              <Field key={f.key} label={t(f.label)}>
                <NumberInput value={form[f.key] as string} onValueChange={(v) => set(f.key, v)} suffix="%" />
              </Field>
            ))}
            {MONEY.map((f) => (
              <Field key={f.key} label={t(f.label)}>
                <NumberInput value={form[f.key] as string} onValueChange={(v) => set(f.key, v)} />
              </Field>
            ))}
            {WHOLE.map((f) => (
              <Field key={f.key} label={t(f.label)}>
                <NumberInput value={form[f.key] as string} onValueChange={(v) => set(f.key, v)} decimal={false} />
              </Field>
            ))}
            <Field label={t("payroll.settings.ptState")}>
              <TextInput value={form.ptState} onChangeText={(v) => set("ptState", v)} maxLength={4} />
            </Field>
          </div>

          <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
            <legend className="mb-1 p-0 text-[14px] font-semibold">{t("payroll.settings.slabs")}</legend>
            {form.slabs.map((s, i) => (
              <div key={i} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <Field label={t("payroll.settings.slabFrom")} className="sm:w-56">
                  <NumberInput value={s.from} onValueChange={(v) => setSlab(i, "from", v)} />
                </Field>
                <Field label={t("payroll.settings.slabTax")} className="sm:w-56">
                  <NumberInput value={s.tax} onValueChange={(v) => setSlab(i, "tax", v)} />
                </Field>
                <Button variant="secondary" size="sm" onClick={() => setForm((f) => ({ ...f, slabs: f.slabs.filter((_, j) => j !== i) }))}>
                  {t("payroll.settings.removeSlab")}
                </Button>
              </div>
            ))}
            <div>
              <Button variant="secondary" size="sm" onClick={() => setForm((f) => ({ ...f, slabs: [...f.slabs, { from: "", tax: "" }] }))}>
                {t("payroll.settings.addSlab")}
              </Button>
            </div>
          </fieldset>

          <Field label={t("payroll.settings.note")} required hint={t("payroll.settings.noteHint")} error={err}>
            <TextInput value={form.note} onChangeText={(v) => set("note", v)} maxLength={500} />
          </Field>
          <div>
            <Button
              loading={save.isPending}
              onClick={() => {
                setTried(true);
                if (checked.ok) save.mutate({ effectiveFrom: checked.effectiveFrom, value: checked.value, note: checked.note });
              }}
            >
              {t("payroll.settings.save")}
            </Button>
          </div>
        </section>
      </Can>
    </>
  );
}
