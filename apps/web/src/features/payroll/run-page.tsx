/**
 * `/payroll/$month`: one month's run. Work out (draft only), the slip table, Check (sends the version the person saw),
 * Reopen, Lock (a manager or admin), the approval link while it waits, and the bank, EPF and ESIC files once it is
 * approved. A row opens the payslip with every line explained.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Calculator, Lock, RotateCcw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { trpc } from "@/shared/utils/trpc";
import type { SlipFigures } from "@orrn/server/lib/hr/payroll";

import { halvesText, monthName } from "./explain";
import { isMonthText, runActions, runTotals, type SlipRow } from "./model";
import { FilesCard } from "./files-card";
import { SlipDialog } from "./slip-dialog";
import { PayrollGate, PayrollTabs, Rupees, StateChip, errorText } from "./ui";

export function RunPage({ month }: { month: string }) {
  const { t } = useT();
  if (!isMonthText(month)) {
    return (
      <>
        <PageHeader title={t("payroll.title")} back={{ to: "/payroll", label: t("payroll.run.back") }} />
        <EmptyState title={t("payroll.loadError")} />
      </>
    );
  }
  return (
    <>
      <PageHeader title={t("payroll.run.title", { month: monthName(t, month) })} back={{ to: "/payroll", label: t("payroll.run.back") }} />
      <PayrollTabs current="runs" />
      <PayrollGate>
        <Run month={month} />
      </PayrollGate>
    </>
  );
}

type Ask = "check" | "reopen" | "lock" | null;

function Run({ month }: { month: string }) {
  const { t } = useT();
  const qc = useQueryClient();
  const q = useQuery(trpc.payroll.runs.get.queryOptions({ month }));
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState("");
  const [slip, setSlip] = useState<SlipFigures | null>(null);

  const refresh = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: trpc.payroll.runs.pathKey() }), qc.invalidateQueries({ queryKey: trpc.approval.pathKey() })]);
  };
  const failed = (e: unknown) => {
    setAsk(null);
    toast.error(errorText(e, t("payroll.loadError")));
    void refresh();
  };

  const compute = useMutation({
    ...trpc.payroll.runs.compute.mutationOptions(),
    onSuccess: async (r) => {
      await refresh();
      toast.success(t("payroll.run.computed", { count: r.headcount }));
    },
    onError: failed,
  });
  const check = useMutation({
    ...trpc.payroll.runs.check.mutationOptions(),
    onSuccess: async () => {
      setAsk(null);
      await refresh();
      toast.success(t("payroll.run.checked"));
    },
    onError: failed,
  });
  const reopen = useMutation({
    ...trpc.payroll.runs.reopen.mutationOptions(),
    onSuccess: async () => {
      setAsk(null);
      await refresh();
      toast.success(t("payroll.run.reopened"));
    },
    onError: failed,
  });
  const lock = useMutation({
    ...trpc.payroll.runs.lock.mutationOptions(),
    onSuccess: async () => {
      setAsk(null);
      await refresh();
      toast.success(t("payroll.run.locked"));
    },
    onError: failed,
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

  const { run, slips } = q.data;
  const a = runActions(run);
  const totals = runTotals(slips);
  const busy = compute.isPending || check.isPending || reopen.isPending || lock.isPending;

  const columns: ResponsiveListColumn<SlipRow>[] = [
    {
      key: "code",
      header: t("payroll.run.code"),
      cell: (r) => (
        <button type="button" onClick={() => setSlip(r.figures)} aria-label={`${t("payroll.run.open")}: ${r.figures.person.code} ${r.figures.person.name}`} className="font-mono whitespace-nowrap text-left underline-offset-2 hover:underline">
          {r.figures.person.code}
        </button>
      ),
    },
    { key: "name", header: t("payroll.run.name"), cell: (r) => r.figures.person.name },
    { key: "days", header: t("payroll.run.paidDays"), align: "end", cell: (r) => <span className="font-mono tabular-nums">{halvesText(r.figures.paidHalves)}</span> },
    { key: "gross", header: t("payroll.run.gross"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.grossPaise} /> },
    { key: "ded", header: t("payroll.run.deductions"), align: "end", hideOnPhone: true, cell: (r) => <Rupees paise={r.figures.totalDeductionsPaise} /> },
    { key: "net", header: t("payroll.run.net"), align: "end", cell: (r) => <Rupees paise={r.netPaise} /> },
    {
      key: "warn",
      header: t("payroll.run.warnCol"),
      hideWhenEmpty: true,
      cell: (r) => (r.figures.notMarked > 0 ? <span className="text-[13px] text-destructive">{t("payroll.run.notMarked", { count: r.figures.notMarked })}</span> : null),
    },
  ];

  return (
    <>
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          {run ? <StateChip status={run.status} /> : null}
          <span className="text-[13px] text-muted-foreground">
            {!run ? t("payroll.run.none") : run.status === "checked" ? t("payroll.run.waiting") : run.status === "approved" ? t("payroll.run.approvedNote") : run.status === "locked" ? t("payroll.run.lockedNote") : t("payroll.run.draftNote")}
          </span>
        </div>
        {!run ? <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.run.noneHint")}</p> : null}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Can do="payroll.run">
            {a.compute ? (
              <Button variant={run ? "secondary" : "primary"} loading={compute.isPending} disabled={busy} onClick={() => compute.mutate({ month })}>
                <Calculator aria-hidden="true" strokeWidth={2} />
                {run ? t("payroll.run.recompute") : t("payroll.run.compute")}
              </Button>
            ) : null}
            {a.check ? (
              <Button disabled={busy} onClick={() => { setNote(""); setAsk("check"); }}>
                <Send aria-hidden="true" strokeWidth={2} />
                {t("payroll.run.check")}
              </Button>
            ) : null}
            {a.reopen ? (
              <Button variant="secondary" disabled={busy} onClick={() => setAsk("reopen")}>
                <RotateCcw aria-hidden="true" strokeWidth={2} />
                {t("payroll.run.reopen")}
              </Button>
            ) : null}
          </Can>
          <Can do="payroll.approve">
            {a.lock ? (
              <Button disabled={busy} onClick={() => setAsk("lock")}>
                <Lock aria-hidden="true" strokeWidth={2} />
                {t("payroll.run.lock")}
              </Button>
            ) : null}
          </Can>
          {a.approvalLink ? (
            <Button asChild variant="secondary">
              <Link to="/approvals">{t("payroll.run.approvalLink")}</Link>
            </Button>
          ) : null}
        </div>
        {run && a.check ? <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.run.checkHint")}</p> : null}
      </section>

      {totals.unmarkedPeople > 0 ? (
        <p role="status" className="m-0 rounded-card border border-border bg-card p-3 text-[13px] text-destructive">
          {t("payroll.run.warnings", { count: totals.unmarkedPeople })}
        </p>
      ) : null}

      {run ? (
        <>
          <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
            <span>{t("payroll.run.headcount", { count: totals.headcount })}</span>
            <span>
              {t("payroll.run.gross")} <Rupees paise={totals.grossPaise} />
            </span>
            <span>
              {t("payroll.run.deductions")} <Rupees paise={totals.deductionsPaise} />
            </span>
            <span className="font-medium text-foreground">
              {t("payroll.run.net")} <Rupees paise={totals.netPaise} />
            </span>
          </p>
          <ResponsiveList<SlipRow>
            label={t("payroll.run.table")}
            rows={slips}
            rowKey={(r) => r.id}
            columns={columns}
            empty={<EmptyState title={t("payroll.run.empty")} />}
          />
        </>
      ) : null}

      {run && a.files ? <FilesCard runId={run.id} /> : null}

      <SlipDialog figures={slip} onClose={() => setSlip(null)} />

      <Dialog
        open={ask === "check"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={t("payroll.run.checkTitle", { month: monthName(t, month) })}
        description={t("payroll.run.checkHint")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsk(null)}>
              {t("payroll.run.cancel")}
            </Button>
            <Button loading={check.isPending} onClick={() => run && check.mutate({ id: run.id, version: run.version, note: note.trim() === "" ? null : note.trim() })}>
              {t("payroll.run.check")}
            </Button>
          </>
        }
      >
        <Field label={t("payroll.run.checkNote")}>
          <TextInput value={note} onChangeText={setNote} maxLength={300} />
        </Field>
      </Dialog>
      <Dialog
        open={ask === "reopen"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={t("payroll.run.reopenTitle", { month: monthName(t, month) })}
        description={t("payroll.run.reopenBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsk(null)}>
              {t("payroll.run.cancel")}
            </Button>
            <Button loading={reopen.isPending} onClick={() => run && reopen.mutate({ id: run.id })}>
              {t("payroll.run.reopen")}
            </Button>
          </>
        }
      />
      <Dialog
        open={ask === "lock"}
        onOpenChange={(open) => !open && setAsk(null)}
        title={t("payroll.run.lockTitle", { month: monthName(t, month) })}
        description={t("payroll.run.lockBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setAsk(null)}>
              {t("payroll.run.cancel")}
            </Button>
            <Button loading={lock.isPending} onClick={() => run && lock.mutate({ id: run.id })}>
              {t("payroll.run.lock")}
            </Button>
          </>
        }
      />
    </>
  );
}
