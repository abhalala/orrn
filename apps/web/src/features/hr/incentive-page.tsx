/** `/hr/incentive`: the month's incentive sheet from the logged press runs, one row per operator, day and shift, with totals per person. */
import { rupeesText } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useFmt } from "@/shared/lib/fmt";
import { bookDayText, kgTrim } from "@/shared/lib/fmt-text";
import { saveTextFile } from "@/shared/lib/exports";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { monthOf, recoveryText, bpText } from "./model";
import { HrGate, HrTabs, LoadError, MonthStepper, Section, errorText, useToday } from "./ui";

export function IncentivePage() {
  const { t } = useT();
  const fmt = useFmt();
  const today = useToday();
  const [month, setMonth] = useState(monthOf(today));
  const [busy, setBusy] = useState(false);
  const q = useQuery(trpc.hr.incentive.sheet.queryOptions({ month }));
  type Row = NonNullable<typeof q.data>["rows"][number];
  type Person = NonNullable<typeof q.data>["byPerson"][number];

  async function download() {
    setBusy(true);
    try {
      const r = await trpcClient.hr.incentive.csv.query({ month });
      saveTextFile(r.filename, r.csv, "text/csv");
    } catch (e) {
      toast.error(errorText(e, t("hr.saveFailed")));
    } finally {
      setBusy(false);
    }
  }

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "name", header: t("hr.incentive.operator"), cell: (r) => (r.name ? <span className="font-semibold">{r.name}</span> : <span className="text-muted-foreground">{t("hr.incentive.unlinked")}</span>) },
    { key: "day", header: t("hr.incentive.day"), cell: (r) => bookDayText(fmt, r.day, today) },
    { key: "shift", header: t("hr.incentive.shift"), hideOnPhone: true, cell: (r) => r.shift || "-" },
    { key: "good", header: t("hr.incentive.good"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{kgTrim(fmt, r.goodG)}</span> },
    { key: "input", header: t("hr.incentive.input"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{kgTrim(fmt, r.inputG)}</span> },
    { key: "reject", header: t("hr.incentive.reject"), align: "end", hideOnPhone: true, cell: (r) => <span className="font-mono tabular-nums">{kgTrim(fmt, r.rejectG)}</span> },
    {
      key: "recovery",
      header: t("hr.incentive.recovery"),
      align: "end",
      cell: (r) => (
        <span className="flex items-center justify-end gap-1.5">
          <span className="font-mono tabular-nums">{recoveryText(r.recoveryBp)}</span>
          {r.belowFloor ? <Chip tone="amber" truncate={false}>{t("hr.incentive.belowFloor")}</Chip> : null}
        </span>
      ),
    },
    { key: "paise", header: t("hr.incentive.amount"), align: "end", cell: (r) => <span className="font-mono tabular-nums whitespace-nowrap">{rupeesText(r.paise)}</span> },
  ];

  const personColumns: ResponsiveListColumn<Person>[] = [
    { key: "name", header: t("hr.incentive.operator"), cell: (r) => <span className="font-semibold">{r.name}</span> },
    { key: "code", header: t("hr.people.code"), hideOnPhone: true, cell: (r) => <span className="font-mono">{r.code}</span> },
    { key: "good", header: t("hr.incentive.good"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{kgTrim(fmt, r.goodG)}</span> },
    { key: "paise", header: t("hr.incentive.total"), align: "end", cell: (r) => <span className="font-mono font-semibold tabular-nums whitespace-nowrap">{rupeesText(r.paise)}</span> },
  ];

  const d = q.data;
  return (
    <HrGate needs={["hr.view"]}>
      <PageHeader
        title={t("hr.incentive.title")}
        subtitle={t("hr.incentive.subtitle")}
        back={{ to: "/hr", label: t("hr.title") }}
        actions={
          <Button variant="secondary" loading={busy} disabled={!d || d.rows.length === 0} onClick={() => void download()}>
            <Download aria-hidden="true" strokeWidth={2} />
            {t("hr.incentive.download")}
          </Button>
        }
      />
      <HrTabs current="incentive" />
      <MonthStepper month={month} onChange={setMonth} />
      {q.isPending ? <Skeleton className="h-48 w-full rounded-card" /> : null}
      {q.isError ? <LoadError onRetry={() => void q.refetch()} /> : null}
      {d ? (
        <>
          <p className="m-0 text-[13px] text-muted-foreground">
            {d.effectiveFrom
              ? t("hr.incentive.ruleLine", { from: d.effectiveFrom, target: kgTrim(fmt, d.rule.targetG), floor: bpText(d.rule.recoveryFloorBp) })
              : t("hr.incentive.noRule")}
          </p>
          {d.byPerson.length > 0 ? (
            <Section id="hr-inc-people" title={t("hr.incentive.perPerson")}>
              <ResponsiveList<Person> label={t("hr.incentive.perPerson")} rows={d.byPerson} rowKey={(r) => r.employeeId} columns={personColumns} empty={<EmptyState title={t("hr.incentive.empty")} />} />
            </Section>
          ) : null}
          <Section id="hr-inc-sheet" title={t("hr.incentive.sheet")} hint={t("hr.incentive.sheetHint")}>
            <ResponsiveList<Row>
              label={t("hr.incentive.sheet")}
              rows={d.rows}
              rowKey={(r) => `${r.userId}|${r.day}|${r.shiftId ?? ""}`}
              columns={columns}
              empty={<EmptyState title={t("hr.incentive.empty")} />}
            />
          </Section>
        </>
      ) : null}
    </HrGate>
  );
}
