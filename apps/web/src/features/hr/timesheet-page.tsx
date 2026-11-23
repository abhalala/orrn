/** `/hr/timesheet`: one person's month: every day's mark, and the totals payroll uses. */
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";

import { useFmt } from "@/shared/lib/fmt";
import { bookDayText, clockText } from "@/shared/lib/fmt-text";
import { trpc } from "@/shared/utils/trpc";

import { halvesToDays, hoursMinutes, markTone, monthOf, paidDaysText } from "./model";
import type { TimesheetSearch } from "./search";
import { HrGate, HrTabs, LoadError, MonthStepper, Pick, useToday } from "./ui";

export function TimesheetPage({ search, onSearch }: { search: TimesheetSearch; onSearch: (next: TimesheetSearch) => void }) {
  const { t } = useT();
  const fmt = useFmt();
  const today = useToday();
  const month = search.month ?? monthOf(today);
  const people = useQuery(trpc.hr.people.options.queryOptions({ includeLeft: true }));
  const personId = search.id ?? "";
  const q = useQuery({ ...trpc.hr.attendance.timesheet.queryOptions({ employeeId: personId, month }), enabled: personId !== "" });
  const set = useCallback((next: Partial<TimesheetSearch>) => onSearch({ id: personId || undefined, month, ...next }), [onSearch, personId, month]);

  const tot = q.data?.totals;
  const ot = tot ? hoursMinutes(tot.overtimeMin) : null;

  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader title={t("hr.timesheet.title")} subtitle={t("hr.timesheet.subtitle")} back={{ to: "/hr", label: t("hr.title") }} />
      <HrTabs current="timesheet" />
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
        <Field label={t("hr.timesheet.person")} className="sm:w-80">
          <Pick
            value={personId}
            onChange={(v) => set({ id: v || undefined })}
            options={[{ value: "", label: t("hr.timesheet.pick") }, ...(people.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.code})${p.status === "left" ? ` · ${t("hr.status.left")}` : ""}` }))]}
          />
        </Field>
        <MonthStepper month={month} onChange={(m) => set({ month: m })} />
      </div>

      {personId === "" ? <EmptyState title={t("hr.timesheet.none")} /> : null}
      {personId !== "" && q.isPending ? <Skeleton className="h-64 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}

      {q.data && tot ? (
        <>
          <dl className="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
            <Total label={t("hr.timesheet.present")} value={halvesToDays(tot.presentHalves)} />
            <Total label={t("hr.timesheet.absent")} value={String(tot.absent)} />
            <Total label={t("hr.timesheet.halfDays")} value={String(tot.halfDays)} />
            <Total label={t("hr.timesheet.leave")} value={String(tot.leavePaid + tot.leaveUnpaid)} />
            <Total label={t("hr.timesheet.weeklyOff")} value={String(tot.weeklyOff)} />
            <Total label={t("hr.timesheet.holidays")} value={String(tot.holiday)} />
            <Total label={t("hr.timesheet.notMarked")} value={String(tot.notMarked)} warn={tot.notMarked > 0} />
            <Total label={t("hr.timesheet.overtime")} value={t("hr.timesheet.hm", { h: ot!.h, m: ot!.m })} />
            <Total label={t("hr.timesheet.paidDays")} value={paidDaysText(tot.paidHalves)} strong />
          </dl>
          <p className="m-0 text-[13px] text-muted-foreground">{t("hr.timesheet.paidHint", { days: tot.days })}</p>
          <div className="overflow-x-auto rounded-card border border-border bg-card">
            <table className="w-full min-w-[34rem] border-collapse text-[14px]">
              <thead>
                <tr className="bg-surface-sunken text-left text-[13px]">
                  <th scope="col" className="px-3 py-2 font-medium">{t("hr.timesheet.day")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("hr.timesheet.status")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("hr.attendance.in")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("hr.attendance.out")}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{t("hr.timesheet.overtime")}</th>
                </tr>
              </thead>
              <tbody>
                {q.data.days.map((d) => {
                  const m = d.mark;
                  const dot = m && m.overtimeMin > 0 ? hoursMinutes(m.overtimeMin) : null;
                  return (
                    <tr key={d.day} className="border-t border-border">
                      <th scope="row" className="px-3 py-2 text-left font-medium whitespace-nowrap">{bookDayText(fmt, d.day, today)}</th>
                      <td className="px-3 py-2">
                        {m ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Chip tone={markTone(m.status)} truncate={false}>{t(`hr.mark.${m.status}`)}</Chip>
                            {m.status === "leave" && m.paidLeave === false ? <span className="text-xs text-muted-foreground">{t("hr.leave.unpaid")}</span> : null}
                            {m.lateEntry ? <Chip tone="amber" truncate={false}>{t("hr.attendance.lateChip")}</Chip> : null}
                          </span>
                        ) : d.holiday ? (
                          <Chip tone="neutral" truncate={false}>{t("hr.mark.holiday")}</Chip>
                        ) : (
                          <span className="text-muted-foreground">{t("hr.attendance.notMarked")}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums">{m?.inAt ? clockText(fmt, m.inAt) : "-"}</td>
                      <td className="px-3 py-2 font-mono tabular-nums">{m?.outAt ? clockText(fmt, m.outAt) : "-"}</td>
                      <td className="px-3 py-2 tabular-nums">{dot ? t("hr.timesheet.hm", { h: dot.h, m: dot.m }) : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </HrGate>
  );
}

function Total({ label, value, warn, strong }: { label: string; value: string; warn?: boolean; strong?: boolean }) {
  return (
    <div className={`rounded-card border p-3 ${warn ? "border-amber-500/60" : "border-border"} ${strong ? "bg-surface-sunken" : "bg-card"}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="m-0 text-[22px] font-bold leading-tight tabular-nums">{value}</dd>
    </div>
  );
}
