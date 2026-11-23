/**
 * `/payroll/settlement/$employeeId`: full and final for a person who has left. Days of salary still unpaid, leave days to
 * encash and recoveries go in; Work out makes a draft statement (gratuity years and the 15/26 formula said in words);
 * Make final is for a manager or admin who did not work it out; Print gives the A4 statement.
 */
import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, NumberInput, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { Chip } from "@orrn/ui/components/chip";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Calculator, Printer } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { paperHtml, printHtml, settlementPaperModel } from "@/shared/lib/payslipPaper";
import { trpc } from "@/shared/utils/trpc";

import { dmy, halvesText, settlementView, type SettlementFigures } from "./explain";
import { ratesInForce, recoveryBoxes, settlementInput, type RecoveryBox } from "./model";
import { PayrollGate, PayrollTabs, Rupees, errorText } from "./ui";

export function SettlementPage({ employeeId }: { employeeId: string }) {
  const { t } = useT();
  return (
    <>
      <PageHeader title={t("payroll.settlement.title")} back={{ to: "/payroll/people", label: t("payroll.settlement.back") }} />
      <PayrollTabs current="people" />
      <PayrollGate>
        <Settlement employeeId={employeeId} />
      </PayrollGate>
    </>
  );
}

function Settlement({ employeeId }: { employeeId: string }) {
  const { t, locale } = useT();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const person = useQuery(trpc.hr.people.get.queryOptions({ id: employeeId }));
  const saved = useQuery(trpc.payroll.settlement.get.queryOptions({ employeeId }));
  const settings = useQuery(trpc.payroll.settings.get.queryOptions());
  const [unpaid, setUnpaid] = useState("");
  const [encash, setEncash] = useState("");
  const [recoveries, setRecoveries] = useState<RecoveryBox[]>([]);
  const [tried, setTried] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const loaded = useRef(false);

  const figures = (saved.data?.figures ?? null) as SettlementFigures | null;
  useEffect(() => {
    if (!figures || loaded.current) return;
    loaded.current = true;
    setUnpaid(figures.inputs.unpaidHalves ? halvesText(figures.inputs.unpaidHalves) : "");
    setEncash(figures.inputs.encashHalves ? halvesText(figures.inputs.encashHalves) : "");
    setRecoveries(recoveryBoxes(figures.lines));
  }, [figures]);

  const refresh = () => qc.invalidateQueries({ queryKey: trpc.payroll.settlement.pathKey() });
  const compute = useMutation({
    ...trpc.payroll.settlement.compute.mutationOptions(),
    onSuccess: async () => {
      await refresh();
      toast.success(t("payroll.settlement.computed"));
    },
    onError: (e) => toast.error(errorText(e, t("payroll.loadError"))),
  });
  const finalize = useMutation({
    ...trpc.payroll.settlement.finalize.mutationOptions(),
    onSuccess: async () => {
      setConfirm(false);
      await refresh();
      toast.success(t("payroll.settlement.finalized"));
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(errorText(e, t("payroll.loadError")));
    },
  });

  const left = person.data?.status === "left" && person.data.leftOn ? person.data.leftOn : null;
  const rates = useMemo(() => {
    if (!settings.data || !left) return null;
    const row = ratesInForce(settings.data.statutory, left.slice(0, 7));
    const v = row?.value ?? settings.data.defaults;
    return { gratuityMinYears: v.gratuityMinYears, gratuityCeilingPaise: v.gratuityCeilingPaise };
  }, [settings.data, left]);
  const view = useMemo(() => (figures ? settlementView(t, figures, rates) : null), [t, figures, rates]);

  if (person.isPending || saved.isPending) return <Skeleton className="h-64 w-full rounded-card" />;
  if (person.isError || !person.data) {
    return (
      <div className="rounded-card border border-border bg-card">
        <EmptyState
          title={t("payroll.loadError")}
          action={
            <Button variant="secondary" onClick={() => void person.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      </div>
    );
  }
  const p = person.data;
  const isFinal = saved.data?.status === "final";
  const checked = settlementInput({ unpaid, encash, recoveries });
  const sameMaker = !!saved.data && !!me && saved.data.createdBy === me.user.id;
  const errText = tried && !checked.ok ? t(`payroll.settlement.${checked.error}` as MessageKey) : undefined;
  const setRec = (i: number, key: keyof RecoveryBox, value: string) => setRecoveries((r) => r.map((x, j) => (j === i ? { ...x, [key]: value } : x)));

  function print() {
    if (!figures) return;
    try {
      printHtml(paperHtml(settlementPaperModel(t, figures, rates, locale, me?.company ? { name: me.company.name } : null)));
    } catch {
      toast.error(t("payroll.settlement.printFailed"));
    }
  }

  return (
    <>
      <section className="flex min-w-0 flex-col gap-1 rounded-card border border-border bg-card p-4">
        <h2 className="m-0 text-[16px] font-semibold">{t("payroll.settlement.subtitle", { name: p.name, code: p.code })}</h2>
        {left ? (
          <>
            <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.settlement.left", { date: dmy(left) })}</p>
            {p.leavingReason ? <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.settlement.reason", { reason: p.leavingReason })}</p> : null}
          </>
        ) : (
          <p role="alert" className="m-0 text-[13px] text-destructive">
            {t("payroll.settlement.notLeft")}
          </p>
        )}
      </section>

      {left ? (
        <Can do="payroll.run">
          {!isFinal ? (
            <section aria-labelledby="pay-fnf-inputs" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4">
              <h2 id="pay-fnf-inputs" className="m-0 text-[15px] font-semibold">
                {t("payroll.settlement.inputs")}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("payroll.settlement.unpaid")} hint={t("payroll.settlement.unpaidHint")} error={errText && checked.ok === false && checked.error === "badDays" ? errText : undefined}>
                  <NumberInput value={unpaid} onValueChange={setUnpaid} />
                </Field>
                <Field label={t("payroll.settlement.encash")} hint={t("payroll.settlement.encashHint")}>
                  <NumberInput value={encash} onValueChange={setEncash} />
                </Field>
              </div>
              <fieldset className="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
                <legend className="mb-1 p-0 text-[14px] font-semibold">{t("payroll.settlement.recoveries")}</legend>
                {recoveries.map((r, i) => (
                  <div key={i} className="flex flex-col gap-3 sm:flex-row sm:items-end">
                    <Field label={t("payroll.settlement.recLabel")} className="sm:w-72">
                      <TextInput value={r.label} onChangeText={(v) => setRec(i, "label", v)} maxLength={60} />
                    </Field>
                    <Field label={t("payroll.settlement.recAmount")} className="sm:w-48">
                      <NumberInput value={r.amount} onValueChange={(v) => setRec(i, "amount", v)} />
                    </Field>
                    <Button variant="secondary" size="sm" onClick={() => setRecoveries((rs) => rs.filter((_, j) => j !== i))}>
                      {t("payroll.settlement.removeRecovery")}
                    </Button>
                  </div>
                ))}
                {errText && checked.ok === false && checked.error !== "badDays" ? (
                  <p role="alert" className="m-0 text-[13px] text-destructive">
                    {errText}
                  </p>
                ) : null}
                <div>
                  <Button variant="secondary" size="sm" onClick={() => setRecoveries((rs) => [...rs, { label: "", amount: "" }])}>
                    {t("payroll.settlement.addRecovery")}
                  </Button>
                </div>
              </fieldset>
              <div>
                <Button
                  loading={compute.isPending}
                  onClick={() => {
                    setTried(true);
                    if (checked.ok) compute.mutate({ employeeId, unpaidHalves: checked.unpaidHalves, encashHalves: checked.encashHalves, recoveries: checked.recoveries });
                  }}
                >
                  <Calculator aria-hidden="true" strokeWidth={2} />
                  {figures ? t("payroll.settlement.recompute") : t("payroll.settlement.compute")}
                </Button>
              </div>
            </section>
          ) : null}
        </Can>
      ) : null}

      <section aria-labelledby="pay-fnf-statement" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="pay-fnf-statement" className="m-0 text-[15px] font-semibold">
            {t("payroll.settlement.statement")}
          </h2>
          {saved.data ? (
            <Chip tone={isFinal ? "green" : "amber"} truncate={false}>
              {isFinal ? t("payroll.settlement.final") : t("payroll.settlement.draft")}
            </Chip>
          ) : null}
        </div>
        {view && figures ? (
          <>
            <p className="m-0 text-[13px] text-muted-foreground">
              {t("payroll.payslip.fnf.service")}: {view.service}
            </p>
            <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
              {view.lines.map((l, i) => (
                <li key={`${l.name}-${i}`} className="flex flex-col gap-0.5 py-2">
                  <div className="flex items-baseline justify-between gap-3 text-[14px]">
                    <span className="min-w-0 break-words">{l.name}</span>
                    <span className={l.paise < 0 ? "text-destructive" : undefined}>
                      {l.paise < 0 ? "-" : ""}
                      <Rupees paise={Math.abs(l.paise)} />
                    </span>
                  </div>
                  {l.why ? <span className="text-[12px] leading-5 text-muted-foreground">{l.why}</span> : null}
                </li>
              ))}
            </ul>
            <div className="flex items-baseline justify-between gap-3 rounded-card border border-border bg-muted/40 px-3 py-2 text-[16px] font-semibold">
              <span>{t("payroll.payslip.fnf.net")}</span>
              <Rupees paise={view.netPaise} />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="secondary" onClick={print}>
                <Printer aria-hidden="true" strokeWidth={2} />
                {t("payroll.settlement.print")}
              </Button>
              <Can do="payroll.approve">
                {!isFinal ? (
                  <Button disabled={sameMaker} onClick={() => setConfirm(true)}>
                    {t("payroll.settlement.finalize")}
                  </Button>
                ) : null}
              </Can>
              {!isFinal ? <span className="text-[13px] text-muted-foreground">{t("payroll.settlement.finalizeHint")}</span> : <span className="text-[13px] text-muted-foreground">{t("payroll.settlement.isFinal")}</span>}
            </div>
          </>
        ) : (
          <p className="m-0 text-[13px] text-muted-foreground">{t("payroll.settlement.noStatement")}</p>
        )}
      </section>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("payroll.settlement.finalizeTitle")}
        description={t("payroll.settlement.finalizeBody")}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              {t("payroll.settlement.cancel")}
            </Button>
            <Button loading={finalize.isPending} onClick={() => finalize.mutate({ employeeId })}>
              {t("payroll.settlement.finalize")}
            </Button>
          </>
        }
      />
    </>
  );
}
