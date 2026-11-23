/** `/payroll`: the months that have a run, newest first, a way to open any month, and the link to the statutory rates. */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Select } from "@orrn/ui/components/select";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { trpc } from "@/shared/utils/trpc";

import { monthName } from "./explain";
import { recentMonths, type RunRow } from "./model";
import { PayrollGate, PayrollTabs, Rupees, StateChip, useToday } from "./ui";

export function RunsPage() {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("payroll.title")} subtitle={t("payroll.subtitle")} />
      <PayrollTabs current="runs" />
      <PayrollGate>
        <Runs />
      </PayrollGate>
    </>
  );
}

function Runs() {
  const { t } = useT();
  const navigate = useNavigate();
  const today = useToday();
  const months = recentMonths(today, 24);
  const [month, setMonth] = useState(months[0]!);
  const list = useQuery(trpc.payroll.runs.list.queryOptions());

  const columns: ResponsiveListColumn<RunRow>[] = [
    { key: "month", header: t("payroll.months.month"), cell: (r) => <span className="font-medium">{monthName(t, r.month)}</span> },
    { key: "status", header: t("payroll.months.status"), phoneWide: true, cell: (r) => <StateChip status={r.status} /> },
    { key: "people", header: t("payroll.months.people"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{r.headcount}</span> },
    { key: "gross", header: t("payroll.months.gross"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.grossPaise} /> },
    { key: "net", header: t("payroll.months.net"), align: "end", cell: (r) => <Rupees paise={r.netPaise} /> },
  ];

  return (
    <>
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:flex-row sm:items-end">
        <Field label={t("payroll.months.pick")} className="sm:w-64">
          <Select value={month} onValueChange={setMonth} options={months.map((m) => ({ value: m, label: monthName(t, m) }))} placeholder={t("payroll.months.pick")} />
        </Field>
        <Button onClick={() => void navigate({ to: "/payroll/$month", params: { month } })}>{t("payroll.months.open")}</Button>
        <Button asChild variant="secondary" className="sm:ml-auto">
          <Link to="/payroll/settings">{t("payroll.months.ratesLink")}</Link>
        </Button>
      </section>

      {list.isError && !list.data ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState
            title={t("payroll.loadError")}
            action={
              <Button variant="secondary" onClick={() => void list.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        </div>
      ) : (
        <ResponsiveList<RunRow>
          label={t("payroll.months.label")}
          rows={list.data ?? []}
          rowKey={(r) => r.id}
          rowHref={(r) => `/payroll/${r.month}`}
          columns={columns}
          loading={list.isPending}
          empty={<EmptyState title={t("payroll.months.empty")} description={t("payroll.months.emptyHint")} />}
        />
      )}
    </>
  );
}
