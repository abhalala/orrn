/**
 * `/payroll/adjustments`: a month's deductions (advance, canteen, other, TDS typed from the CA) and extra earnings. They go
 * into the next work-out of that month's run. TDS is a figure the office types from the CA; orrn never works it out.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Select } from "@orrn/ui/components/select";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";

import { rs, monthName } from "./explain";
import { ADJUSTMENT_KINDS, adjustmentInput, adjustmentTotals, recentMonths, type AdjustmentKind, type AdjustmentRow } from "./model";
import { PayrollGate, PayrollTabs, Rupees, errorText, usePeopleOptions, useToday } from "./ui";

export function AdjustmentsPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("payroll.adj.title")} subtitle={t("payroll.adj.subtitle")} />
      <PayrollTabs current="adjustments" />
      <PayrollGate>
        <Adjustments />
      </PayrollGate>
    </>
  );
}

const kindWord = (k: AdjustmentKind) => `payroll.adj.kinds.${k}` as MessageKey;

function Adjustments() {
  const { t } = useT();
  const qc = useQueryClient();
  const today = useToday();
  const months = recentMonths(today, 24);
  const [month, setMonth] = useState(months[0]!);
  const [employeeId, setEmployeeId] = useState("");
  const [kind, setKind] = useState<AdjustmentKind>("advance");
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [tried, setTried] = useState(false);

  const list = useQuery(trpc.payroll.adjustments.list.queryOptions({ month }));
  const people = usePeopleOptions();
  const refresh = () => qc.invalidateQueries({ queryKey: trpc.payroll.adjustments.pathKey() });

  const add = useMutation({
    ...trpc.payroll.adjustments.add.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      setAmount("");
      setLabel("");
      setTried(false);
      toast.success(t("payroll.adj.added"));
    },
    onError: (e) => toast.error(errorText(e, t("payroll.adj.closed"))),
  });
  const remove = useMutation({
    ...trpc.payroll.adjustments.remove.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("payroll.adj.removed"));
    },
    onError: (e) => toast.error(errorText(e, t("payroll.adj.closed"))),
  });

  const rows = list.data ?? [];
  const totals = adjustmentTotals(rows);
  const checked = adjustmentInput({ employeeId, kind, label, amount });

  const columns: ResponsiveListColumn<AdjustmentRow>[] = [
    { key: "code", header: t("payroll.adj.code"), cell: (r) => <span className="font-mono whitespace-nowrap">{r.code}</span> },
    { key: "name", header: t("payroll.adj.name"), cell: (r) => r.name },
    { key: "kind", header: t("payroll.adj.kind"), cell: (r) => t(kindWord(r.kind)) },
    { key: "label", header: t("payroll.adj.label"), hideOnPhone: true, hideWhenEmpty: true, cell: (r) => r.label },
    { key: "amount", header: t("payroll.adj.amount"), align: "end", cell: (r) => <Rupees paise={r.amountPaise} /> },
    {
      key: "act",
      header: t("payroll.adj.remove"),
      headerHidden: true,
      cell: (r) => (
        <Can do="payroll.run">
          <Button variant="secondary" size="sm" loading={remove.isPending && remove.variables?.id === r.id} onClick={() => remove.mutate({ id: r.id })}>
            {t("payroll.adj.remove")}
          </Button>
        </Can>
      ),
    },
  ];

  return (
    <>
      <Field label={t("payroll.adj.month")} className="sm:w-64">
        <Select value={month} onValueChange={setMonth} options={months.map((m) => ({ value: m, label: monthName(t, m) }))} placeholder={t("payroll.adj.month")} />
      </Field>

      <Can do="payroll.run">
        <section aria-labelledby="pay-adj-form" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
          <h2 id="pay-adj-form" className="m-0 text-[15px] font-semibold">
            {t("payroll.adj.add")}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("payroll.adj.person")} required error={tried && !checked.ok && checked.error === "needPerson" ? t("payroll.adj.needPerson") : undefined}>
              <Select value={employeeId} onValueChange={setEmployeeId} options={(people.data ?? []).map((p) => ({ value: p.id, label: `${p.code} ${p.name}` }))} placeholder={t("payroll.adj.pickPerson")} />
            </Field>
            <Field label={t("payroll.adj.kind")} hint={kind === "tds" ? t("payroll.adj.tdsHint") : undefined}>
              <Select value={kind} onValueChange={(v) => setKind(v as AdjustmentKind)} options={ADJUSTMENT_KINDS.map((k) => ({ value: k, label: t(kindWord(k)) }))} />
            </Field>
            <Field label={t("payroll.adj.amount")} required error={tried && !checked.ok && checked.error === "needAmount" ? t("payroll.adj.needAmount") : undefined}>
              <NumberInput value={amount} onValueChange={setAmount} />
            </Field>
            <Field label={t("payroll.adj.label")}>
              <TextInput value={label} onChangeText={setLabel} maxLength={60} />
            </Field>
          </div>
          <div>
            <Button
              loading={add.isPending}
              onClick={() => {
                setTried(true);
                if (checked.ok) add.mutate({ ...checked.input, month });
              }}
            >
              {t("payroll.adj.add")}
            </Button>
          </div>
        </section>
      </Can>

      <section className="flex min-w-0 flex-col gap-3">
        <h2 className="m-0 text-[15px] font-semibold">{t("payroll.adj.list", { month: monthName(t, month) })}</h2>
        <ResponsiveList<AdjustmentRow>
          label={t("payroll.adj.list", { month: monthName(t, month) })}
          rows={rows}
          rowKey={(r) => r.id}
          columns={columns}
          loading={list.isPending}
          empty={<EmptyState title={t("payroll.adj.empty")} />}
        />
        {rows.length > 0 ? <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.adj.total", { deductions: rs(totals.deductionsPaise), earnings: rs(totals.earningsPaise) })}</p> : null}
      </section>
    </>
  );
}
