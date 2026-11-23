/**
 * `/me`: the signed-in person's own page: attendance this month, leave balances and applying for leave, their requests
 * (a waiting one can be cancelled) and, when payroll is on, their locked payslips with print. Nothing here names an
 * employee: the server finds the person from the sign-in. A login with no person behind it is told to ask the office.
 */
import { isModuleOn } from "@orrn/domain";
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Select } from "@orrn/ui/components/select";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { monthName, dmy } from "@/features/payroll/explain";
import { SlipDialog, usePrintPayslip } from "@/features/payroll/slip-dialog";
import { Rupees, errorText } from "@/features/payroll/ui";
import { can, useMe } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";

import { attendanceTotals, canCancel, dayMark, daysText, leaveInput, statusTone, type LeaveForm, type LeaveStatus } from "./model";

export function MePage() {
  const { t } = useT();
  const { data: me, isPending } = useMe();
  return (
    <>
      <PageHeader title={t("payroll.me.title")} subtitle={t("payroll.me.subtitle")} />
      {isPending ? (
        <Skeleton className="h-40 w-full rounded-card" />
      ) : !isModuleOn(me?.company?.modules, "hr") || !can(me, "leave.apply") ? (
        <EmptyState title={t("payroll.off")} />
      ) : (
        <Me payrollOn={isModuleOn(me?.company?.modules, "payroll")} />
      )}
    </>
  );
}

const isNotFound = (e: unknown) => typeof e === "object" && e !== null && (e as { data?: { code?: string } }).data?.code === "NOT_FOUND";

function Me({ payrollOn }: { payrollOn: boolean }) {
  const { t } = useT();
  const summary = useQuery(trpc.hr.me.summary.queryOptions());
  if (summary.isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (summary.isError || !summary.data) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={isNotFound(summary.error) ? t("payroll.me.notLinked") : t("payroll.me.loadError")}
          action={
            isNotFound(summary.error) ? undefined : (
              <Button variant="secondary" onClick={() => void summary.refetch()}>
                {t("common.retry")}
              </Button>
            )
          }
        />
      </div>
    );
  }
  const s = summary.data;
  return (
    <>
      <Attendance month={s.month} totals={s.totals} />
      <Balances balances={s.balances} />
      <Apply today={s.today} />
      <Requests />
      {payrollOn ? <Payslips /> : null}
    </>
  );
}

function Attendance({ month, totals }: { month: string; totals: Parameters<typeof attendanceTotals>[0] }) {
  const { t } = useT();
  const days = useQuery(trpc.hr.me.attendance.queryOptions({ month }));
  return (
    <section aria-labelledby="me-att" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="me-att" className="m-0 text-[15px] font-semibold">
        {t("payroll.me.attendance")} <span className="font-normal text-muted-foreground">({monthName(t, month)})</span>
      </h2>
      <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {attendanceTotals(totals).map((x) => (
          <div key={x.key} className="flex flex-col">
            <dt className="text-[12px] text-muted-foreground">{t(`payroll.me.${x.key}` as MessageKey)}</dt>
            <dd className="m-0 font-mono text-[18px] tabular-nums">{x.value}</dd>
          </div>
        ))}
        {totals.overtimeMin > 0 ? (
          <div className="flex flex-col">
            <dt className="text-[12px] text-muted-foreground">{t("payroll.me.overtime")}</dt>
            <dd className="m-0 font-mono text-[18px] tabular-nums">{t("payroll.payslip.explain.time", { hours: Math.floor(totals.overtimeMin / 60), minutes: totals.overtimeMin % 60 })}</dd>
          </div>
        ) : null}
      </dl>
      <details>
        <summary className="cursor-pointer text-[13px] font-medium">{t("payroll.me.days")}</summary>
        {days.isPending ? (
          <Skeleton className="mt-2 h-24 w-full" />
        ) : (
          <ul className="m-0 mt-2 grid list-none grid-cols-1 gap-x-6 p-0 sm:grid-cols-2">
            {(days.data?.days ?? []).map((d) => (
              <li key={d.day} className="flex items-baseline justify-between gap-3 border-b border-border py-1 text-[13px]">
                <span className="font-mono">{dmy(d.day)}</span>
                <span>{t(`payroll.me.mark_${dayMark(d)}` as MessageKey)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </section>
  );
}

function Balances({ balances }: { balances: ReadonlyArray<{ kindId: string; name: string; quotaHalves: number; carryInHalves: number; takenHalves: number; balanceHalves: number; pendingHalves: number }> }) {
  const { t } = useT();
  return (
    <section aria-labelledby="me-bal" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="me-bal" className="m-0 text-[15px] font-semibold">
        {t("payroll.me.balances")}
      </h2>
      {balances.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.me.balancesEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {balances.map((b) => (
            <li key={b.kindId} className="grid grid-cols-2 gap-2 py-2 text-[13px] sm:grid-cols-5">
              <span className="col-span-2 text-[14px] font-medium sm:col-span-1">{b.name}</span>
              <span>
                {t("payroll.me.balanceQuota")} <b className="font-mono">{daysText(b.quotaHalves + b.carryInHalves)}</b>
              </span>
              <span>
                {t("payroll.me.balanceTaken")} <b className="font-mono">{daysText(b.takenHalves)}</b>
              </span>
              <span>
                {t("payroll.me.balanceWaiting")} <b className="font-mono">{daysText(b.pendingHalves)}</b>
              </span>
              <span>
                {t("payroll.me.balanceLeft")} <b className="font-mono">{daysText(b.balanceHalves)}</b>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Apply({ today }: { today: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const kinds = useQuery(trpc.hr.leave.kinds.queryOptions());
  const [form, setForm] = useState<LeaveForm>({ kindId: "", from: today, to: today, halfDay: false, reason: "" });
  const [tried, setTried] = useState(false);
  const checked = leaveInput(form);
  const send = useMutation({
    ...trpc.hr.me.applyLeave.mutationOptions(),
    onSuccess: async () => {
      setTried(false);
      setForm((f) => ({ ...f, reason: "" }));
      await qc.invalidateQueries({ queryKey: trpc.hr.me.pathKey() });
      toast.success(t("payroll.me.sent"));
    },
    onError: (e) => toast.error(errorText(e, t("payroll.me.loadError"))),
  });
  const set = <K extends keyof LeaveForm>(k: K, v: LeaveForm[K]) => setForm((f) => ({ ...f, [k]: v }));
  const active = (kinds.data ?? []).filter((k) => k.active);
  return (
    <section aria-labelledby="me-apply" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
      <h2 id="me-apply" className="m-0 text-[15px] font-semibold">
        {t("payroll.me.apply")}
      </h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t("payroll.me.kind")} required error={tried && !checked.ok && checked.error === "needKind" ? t("payroll.me.needKind") : undefined}>
          <Select value={form.kindId} onValueChange={(v) => set("kindId", v)} options={active.map((k) => ({ value: k.id, label: k.name }))} placeholder={t("payroll.me.pickKind")} />
        </Field>
        <Field label={t("payroll.me.from")} required error={tried && !checked.ok && checked.error === "needDays" ? t("payroll.me.needDays") : undefined}>
          <TextInput type="date" value={form.from} onChangeText={(v) => setForm((f) => ({ ...f, from: v, to: f.to < v ? v : f.to }))} />
        </Field>
        <Field label={t("payroll.me.to")} required>
          <TextInput type="date" value={form.to} min={form.from} onChangeText={(v) => set("to", v)} />
        </Field>
      </div>
      <label className="flex items-center gap-3 text-[14px]">
        <Checkbox checked={form.halfDay} onCheckedChange={(v) => set("halfDay", v === true)} />
        {t("payroll.me.halfDay")}
      </label>
      <Field label={t("payroll.me.reason")}>
        <TextInput value={form.reason} onChangeText={(v) => set("reason", v)} maxLength={300} />
      </Field>
      <div>
        <Button
          loading={send.isPending}
          onClick={() => {
            setTried(true);
            if (checked.ok) send.mutate(checked.input);
          }}
        >
          {t("payroll.me.send")}
        </Button>
      </div>
    </section>
  );
}

function Requests() {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.hr.me.leave.queryOptions());
  const cancel = useMutation({
    ...trpc.hr.me.cancelLeave.mutationOptions(),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: trpc.hr.me.pathKey() });
      toast.success(t("payroll.me.cancelled"));
    },
    onError: (e) => {
      toast.error(errorText(e, t("payroll.me.loadError")));
      void qc.invalidateQueries({ queryKey: trpc.hr.me.pathKey() });
    },
  });
  const rows = q.data ?? [];
  return (
    <section aria-labelledby="me-req" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="me-req" className="m-0 text-[15px] font-semibold">
        {t("payroll.me.requests")}
      </h2>
      {q.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.me.requestsEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="m-0 text-[14px] font-medium">
                  {r.kindName} · {t("payroll.me.requestDays", { from: dmy(r.fromDay), to: dmy(r.toDay) })}
                </p>
                <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.me.requestHalves", { days: daysText(r.halves) })}</p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={statusTone(r.status)} truncate={false}>
                  {t(`payroll.me.status.${r.status as LeaveStatus}` as MessageKey)}
                </Chip>
                {canCancel(r.status) ? (
                  <Button variant="secondary" size="sm" loading={cancel.isPending && cancel.variables?.id === r.id} onClick={() => cancel.mutate({ id: r.id })}>
                    {t("payroll.me.cancel")}
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Payslips() {
  const { t } = useT();
  const q = useQuery(trpc.payroll.me.payslips.queryOptions());
  const [open, setOpen] = useState<SlipFigures | null>(null);
  const print = usePrintPayslip();
  const rows = q.data ?? [];
  return (
    <section aria-labelledby="me-slips" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id="me-slips" className="m-0 text-[15px] font-semibold">
        {t("payroll.me.payslips")}
      </h2>
      {q.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : rows.length === 0 ? (
        <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.me.payslipsEmpty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="m-0 text-[14px] font-medium">{monthName(t, r.month)}</p>
                <p className="m-0 text-[13px] text-muted-foreground">
                  {t("payroll.me.net")} <Rupees paise={r.netPaise} />
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" aria-label={`${t("payroll.me.open")}: ${monthName(t, r.month)}`} onClick={() => setOpen(r.figures)}>
                  {t("payroll.me.open")}
                </Button>
                <Button variant="secondary" size="sm" aria-label={`${t("payroll.me.print")}: ${monthName(t, r.month)}`} onClick={() => print(r.figures)}>
                  <Printer aria-hidden="true" strokeWidth={2} />
                  {t("payroll.me.print")}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <SlipDialog figures={open} onClose={() => setOpen(null)} />
    </section>
  );
}
