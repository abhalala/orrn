/**
 * `/payroll/people`: the salary register for a month (the structure in force for everyone), one person's structure
 * history, and the form that saves a structure dated by month: basic, DA, HRA, other, per day or per month, EPF, ESIC
 * and professional tax flags. Saving changes the figures from that month on; a locked or checked month is refused.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { monthName } from "./explain";
import { emptyStructureForm, formFromStructure, recentMonths, structureInput, type StructureError, type StructureForm, type StructureRow } from "./model";
import { PayrollGate, PayrollTabs, Rupees, errorText, usePeopleOptions, useToday } from "./ui";

export function PeoplePage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("payroll.people.title")} subtitle={t("payroll.people.subtitle")} />
      <PayrollTabs current="people" />
      <PayrollGate>
        <People />
      </PayrollGate>
    </>
  );
}

type History = NonNullable<ReturnType<typeof useHistory>["data"]>[number];

function useHistory(employeeId: string) {
  return useQuery({ ...trpc.payroll.structures.list.queryOptions({ employeeId }), enabled: employeeId !== "" });
}

function People() {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const months = recentMonths(today, 24);
  const [month, setMonth] = useState(months[0]!);
  const [form, setForm] = useState<StructureForm>(() => emptyStructureForm(months[0]!));
  const [tried, setTried] = useState(false);

  const register = useQuery(trpc.payroll.structures.register.queryOptions({ month }));
  const people = usePeopleOptions();
  const history = useHistory(form.employeeId);
  const who = people.data?.find((p) => p.id === form.employeeId);

  const set = <K extends keyof StructureForm>(key: K, value: StructureForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = useMutation({
    ...trpc.payroll.structures.save.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.payroll.structures.pathKey() });
      await qc.invalidateQueries({ queryKey: trpc.payroll.runs.pathKey() });
      toast.success(t("payroll.people.saved"));
    },
    onError: (e) => toast.error(errorText(e, t("payroll.loadError"))),
  });

  const checked = structureInput(form);
  const errorKey = (e: StructureError): MessageKey => `payroll.people.${e}` as MessageKey;
  const fieldError = (...errs: StructureError[]) => (tried && !checked.ok && errs.includes(checked.error) ? t(errorKey(checked.error)) : undefined);

  const columns: ResponsiveListColumn<StructureRow>[] = [
    {
      key: "code",
      header: t("payroll.people.code"),
      cell: (r) => (
        <button
          type="button"
          aria-label={`${t("payroll.people.pick")}: ${r.code} ${r.name}`}
          onClick={() => {
            setForm(formFromStructure(r, month));
            setTried(false);
          }}
          className="font-mono whitespace-nowrap text-left underline-offset-2 hover:underline"
        >
          {r.code}
        </button>
      ),
    },
    { key: "name", header: t("payroll.people.name"), cell: (r) => r.name },
    { key: "basic", header: t("payroll.people.basic"), align: "end", cell: (r) => <Rupees paise={r.basicPaise} /> },
    { key: "da", header: t("payroll.people.da"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.daPaise} /> },
    { key: "hra", header: t("payroll.people.hra"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.hraPaise} /> },
    { key: "other", header: t("payroll.people.other"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.otherPaise} /> },
    { key: "basis", header: t("payroll.people.basis"), hideOnPhone: true, cell: (r) => (r.perDay ? t("payroll.people.basisDay") : t("payroll.people.basisMonth")) },
    {
      key: "flags",
      header: t("payroll.people.flags"),
      hideOnPhone: true,
      cell: (r) => [r.pfMember ? t("payroll.people.flagEpf") : null, r.esicMember ? t("payroll.people.flagEsic") : null, r.ptApplies ? t("payroll.people.flagPt") : null].filter(Boolean).join(", "),
    },
    { key: "from", header: t("payroll.people.from"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.effectiveFrom}</span> },
  ];

  const historyColumns: ResponsiveListColumn<History>[] = [
    { key: "from", header: t("payroll.people.from"), cell: (r) => <span className="font-mono">{r.effectiveFrom}</span> },
    { key: "basic", header: t("payroll.people.basic"), align: "end", cell: (r) => <Rupees paise={r.basicPaise} /> },
    { key: "total", header: t("payroll.people.basis"), align: "end", hideOnPhone: true, cell: (r) => (r.perDay ? t("payroll.people.basisDay") : t("payroll.people.basisMonth")) },
  ];

  return (
    <>
      <section className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="m-0 text-[15px] font-semibold">{t("payroll.people.register", { month: monthName(t, month) })}</h2>
          <Field label={t("payroll.people.month")} className="sm:w-56">
            <Select value={month} onValueChange={setMonth} options={months.map((m) => ({ value: m, label: monthName(t, m) }))} placeholder={t("payroll.people.month")} />
          </Field>
        </div>
        <ResponsiveList<StructureRow>
          label={t("payroll.people.registerLabel")}
          rows={register.data ?? []}
          rowKey={(r) => r.id}
          columns={columns}
          loading={register.isPending}
          empty={<EmptyState title={t("payroll.people.empty")} />}
        />
      </section>

      <Can do="payroll.run">
        <section aria-labelledby="pay-structure-form" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
          <div>
            <h2 id="pay-structure-form" className="m-0 text-[15px] font-semibold">
              {t("payroll.people.formTitle")}
            </h2>
            <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.people.formHint")}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("payroll.people.person")} required error={fieldError("needPerson")}>
              <Select
                value={form.employeeId}
                onValueChange={(v) => setForm((f) => ({ ...emptyStructureForm(f.effectiveFrom, v) }))}
                options={(people.data ?? []).map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))}
                placeholder={t("payroll.people.pickPerson")}
              />
            </Field>
            <Field label={t("payroll.people.effectiveFrom")} required error={fieldError("needMonth")} hint="2026-11">
              <TextInput value={form.effectiveFrom} onChangeText={(v) => set("effectiveFrom", v)} maxLength={7} inputMode="numeric" />
            </Field>
            <Field label={t("payroll.people.basicBox")} required error={fieldError("needBasic", "badAmount")}>
              <NumberInput value={form.basic} onValueChange={(v) => set("basic", v)} />
            </Field>
            <Field label={t("payroll.people.daBox")}>
              <NumberInput value={form.da} onValueChange={(v) => set("da", v)} />
            </Field>
            <Field label={t("payroll.people.hraBox")}>
              <NumberInput value={form.hra} onValueChange={(v) => set("hra", v)} />
            </Field>
            <Field label={t("payroll.people.otherBox")}>
              <NumberInput value={form.other} onValueChange={(v) => set("other", v)} />
            </Field>
          </div>
          <SegmentedControl
            label={t("payroll.people.perDay")}
            value={form.perDay ? "day" : "month"}
            onChange={(v) => set("perDay", v === "day")}
            options={[
              { value: "month", label: t("payroll.people.perDayNo") },
              { value: "day", label: t("payroll.people.perDayYes") },
            ]}
          />
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 text-[14px]">
              <Checkbox checked={form.pfMember} onCheckedChange={(v) => set("pfMember", v === true)} />
              {t("payroll.people.pfMember")}
            </label>
            {form.pfMember ? (
              <label className="flex items-center gap-3 text-[14px]">
                <Checkbox checked={form.pfOnActual} onCheckedChange={(v) => set("pfOnActual", v === true)} />
                {t("payroll.people.pfOnActual")}
              </label>
            ) : null}
            <label className="flex items-center gap-3 text-[14px]">
              <Checkbox checked={form.esicMember} onCheckedChange={(v) => set("esicMember", v === true)} />
              {t("payroll.people.esicMember")}
            </label>
            {form.esicMember ? (
              <Field label={t("payroll.people.esicCovered")} className="sm:w-80">
                <Select
                  value={form.esicCovered}
                  onValueChange={(v) => set("esicCovered", v as StructureForm["esicCovered"])}
                  options={[
                    { value: "auto", label: t("payroll.people.esicAuto") },
                    { value: "yes", label: t("payroll.people.esicYes") },
                    { value: "no", label: t("payroll.people.esicNo") },
                  ]}
                />
              </Field>
            ) : null}
            <label className="flex items-center gap-3 text-[14px]">
              <Checkbox checked={form.ptApplies} onCheckedChange={(v) => set("ptApplies", v === true)} />
              {t("payroll.people.ptApplies")}
            </label>
          </div>
          <div>
            <Button
              loading={save.isPending}
              onClick={() => {
                setTried(true);
                if (checked.ok) save.mutate(checked.input);
              }}
            >
              {t("payroll.people.save")}
            </Button>
          </div>
        </section>
      </Can>

      {form.employeeId ? (
        <section className="flex min-w-0 flex-col gap-3">
          <h2 className="m-0 text-[15px] font-semibold">{t("payroll.people.history", { name: who ? `${who.code} ${who.name}` : "" })}</h2>
          <ResponsiveList<History>
            label={t("payroll.people.history", { name: who?.name ?? "" })}
            rows={history.data ?? []}
            rowKey={(r) => r.id}
            columns={historyColumns}
            loading={history.isPending}
            empty={<EmptyState title={t("payroll.people.historyEmpty")} />}
          />
        </section>
      ) : null}
    </>
  );
}
