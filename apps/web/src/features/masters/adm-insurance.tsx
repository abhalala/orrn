import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { EMPTY_INSURANCE, insuranceProblems, insuranceState, type InsuranceForm, type InsuranceProblems, type InsuranceState } from "./adm-model";
import { AdmFormError } from "./adm-ui";
import { useAdmAccess, useAdmInvalidate } from "./adm-use";
import { companyToday, MasterNote, MastersLoadError } from "./masters-ui";
import { formatDay } from "./masters-model";
import { useFmt } from "@/shared/lib/fmt";

const STATE_TONE: Record<InsuranceState, "green" | "amber" | "red" | "neutral" | null> = { none: null, open: "green", valid: "green", soon: "amber", expired: "red", notStarted: "neutral" };

/** Transit insurance (publishers): the policy that prints on the packing list, with its dates. */
export function InsurancePanel() {
  const { t } = useT();
  const fmt = useFmt();
  const access = useAdmAccess();
  const invalidate = useAdmInvalidate();
  const query = useQuery(trpc.masters.insurance.get.queryOptions());
  const set = useMutation(trpc.masters.insurance.set.mutationOptions());
  const [form, setForm] = useState<InsuranceForm>(EMPTY_INSURANCE);
  const [problems, setProblems] = useState<InsuranceProblems>({});
  const today = companyToday(access.me?.company?.settings?.timezone);

  useEffect(() => {
    if (query.data === undefined) return;
    const d = query.data;
    setForm(d ? { policyNo: d.policyNo, insurer: d.insurer, validFrom: d.validFrom ?? "", validTo: d.validTo ?? "", printOnPl: d.printOnPl } : EMPTY_INSURANCE);
    setProblems({});
  }, [query.data]);

  if (query.isError && !query.data) return <MastersLoadError onRetry={() => void query.refetch()} />;

  const patch = (p: Partial<InsuranceForm>) => setForm((f) => ({ ...f, ...p }));
  const state = insuranceState(query.data ?? null, today);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (set.isPending) return;
    const found = insuranceProblems(form);
    setProblems(found);
    if (Object.keys(found).length > 0) return;
    try {
      await set.mutateAsync({ policyNo: form.policyNo.trim(), insurer: form.insurer.trim(), validFrom: form.validFrom || null, validTo: form.validTo || null, printOnPl: form.printOnPl });
      toast.success(t("adm.masters.rules.insurance.saved"));
      await invalidate.insurance();
    } catch {
      // Shown under the form.
    }
  };

  const remove = async () => {
    if (set.isPending) return;
    try {
      await set.mutateAsync(null);
      toast.success(t("adm.masters.rules.insurance.removed"));
      await invalidate.insurance();
    } catch {
      // Shown under the form.
    }
  };

  const dates = query.data
    ? [query.data.validFrom ? formatDay(fmt, query.data.validFrom, today) : null, query.data.validTo ? formatDay(fmt, query.data.validTo, today) : null]
    : [null, null];

  return (
    <div className="flex min-w-0 flex-col gap-4 md:max-w-[560px]">
      <MasterNote body={access.canPublish ? t("adm.masters.rules.insurance.note") : t("masters.readOnly")} />
      {query.data ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {STATE_TONE[state] ? <Chip tone={STATE_TONE[state]!}>{t(`adm.masters.rules.insurance.state.${state}`)}</Chip> : null}
          {dates[0] || dates[1] ? (
            <span className="text-[14px] text-muted-foreground">{t("adm.masters.rules.insurance.dates", { from: dates[0] ?? "-", to: dates[1] ?? "-" })}</span>
          ) : null}
        </div>
      ) : null}
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
        <Field label={t("adm.masters.rules.insurance.policyNo")} error={problems.policyNo ? t(problems.policyNo) : undefined}>
          <TextInput value={form.policyNo} maxLength={60} autoComplete="off" disabled={!access.canPublish} aria-required="true" className="font-mono" onChangeText={(v) => patch({ policyNo: v })} />
        </Field>
        <Field label={t("adm.masters.rules.insurance.insurer")} error={problems.insurer ? t(problems.insurer) : undefined}>
          <TextInput value={form.insurer} maxLength={80} autoComplete="off" disabled={!access.canPublish} aria-required="true" onChangeText={(v) => patch({ insurer: v })} />
        </Field>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t("adm.masters.rules.insurance.validFrom")}>
            <TextInput type="date" value={form.validFrom} disabled={!access.canPublish} onChangeText={(v) => patch({ validFrom: v })} />
          </Field>
          <Field label={t("adm.masters.rules.insurance.validTo")} error={problems.validTo ? t(problems.validTo) : undefined}>
            <TextInput type="date" value={form.validTo} disabled={!access.canPublish} onChangeText={(v) => patch({ validTo: v })} />
          </Field>
        </div>
        <label className="flex min-h-11 items-center gap-3 text-[15px]">
          <input
            type="checkbox"
            checked={form.printOnPl}
            disabled={!access.canPublish}
            onChange={(e) => patch({ printOnPl: e.currentTarget.checked })}
            className="size-5 accent-[var(--color-foreground)]"
          />
          <span>{t("adm.masters.rules.insurance.printOnPl")}</span>
        </label>
        <AdmFormError error={set.error} />
        <Can do="masters.publish">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" size="lg" loading={set.isPending}>
              {t("adm.masters.rules.insurance.save")}
            </Button>
            {query.data ? (
              <Button variant="ghost" onClick={() => void remove()} disabled={set.isPending}>
                {t("adm.masters.rules.insurance.remove")}
              </Button>
            ) : null}
          </div>
        </Can>
      </form>
    </div>
  );
}
