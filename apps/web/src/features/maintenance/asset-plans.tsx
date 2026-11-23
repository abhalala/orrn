import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { Sheet } from "@orrn/ui/components/sheet";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Can } from "@/shared/components/can";
import { useOnceMutation } from "@/shared/lib/once-mutation";
import { trpc } from "@/shared/utils/trpc";

import { FieldTextArea } from "./field-controls";
import { emptyPlanForm, formFromPlan, planPayload, planProblem, type PlanFormState } from "./asset-model";
import { PlanInterval, Section } from "./asset-parts";
import { DUE_TONE, dueLines, isDueState, maintErrorKey, type PlanDue } from "./model";

export type PlanItem = {
  id: string;
  title: string;
  steps: string | null;
  intervalDays: number | null;
  intervalHours: number | null;
  active: boolean;
  due: PlanDue | null;
  openWorkOrderId: string | null;
  openWorkOrderNumber: string | null;
};

/** One plan: title, interval, due chip and words, the open work order. Switched-off plans are dimmed. */
export function PlanCard({ plan, actions }: { plan: PlanItem; actions?: ReactNode }) {
  const { t } = useT();
  const due = plan.active ? plan.due : null;
  return (
    <li className={`flex min-w-0 flex-col gap-2 rounded-card border border-border p-3 ${plan.active ? "" : "opacity-60"}`} data-testid="plan-card" data-active={plan.active}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 text-[15px] font-semibold break-words">{plan.title}</p>
          <p className="m-0 text-[13px] text-muted-foreground">
            <PlanInterval days={plan.intervalDays} hours={plan.intervalHours} />
          </p>
        </div>
        {!plan.active ? (
          <Chip tone="neutral" truncate={false}>
            {t("maint.assets.plans.inactive")}
          </Chip>
        ) : due && isDueState(due.state) ? (
          <Chip tone={DUE_TONE[due.state]} truncate={false}>
            {t(`maint.due.state.${due.state}`)}
          </Chip>
        ) : null}
      </div>
      {due ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[14px]">
          {dueLines(due).map((l) => (
            <li key={l.key}>{t(l.key, l.vars)}</li>
          ))}
        </ul>
      ) : null}
      {plan.steps ? <p className="m-0 text-[14px] break-words whitespace-pre-wrap text-muted-foreground">{plan.steps}</p> : null}
      {plan.openWorkOrderId ? (
        <p className="m-0 text-[14px]">
          <UiLink to={`/maintenance/work-orders/${plan.openWorkOrderId}`} className="font-mono font-semibold underline underline-offset-4">
            {t("maint.assets.plans.workOrder", { number: plan.openWorkOrderNumber ?? "" })}
          </UiLink>
        </p>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </li>
  );
}

export function PlansSection({ assetId, linked, plans }: { assetId: string; linked: boolean; plans: readonly PlanItem[] }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const make = useOnceMutation(
    trpc.maint.plans.makeWorkOrder.mutationOptions({
      onSuccess: (r) => {
        void queryClient.invalidateQueries(trpc.maint.pathFilter());
        void navigate({ to: "/maintenance/work-orders/$id", params: { id: r.id } });
      },
      onError: (e) => toast.error(t(maintErrorKey(e))),
    }),
  );
  return (
    <Section
      title={t("maint.assets.plans.title")}
      hint={t("maint.assets.plans.hint")}
      testId="asset-plans"
      actions={
        <Can do="maint.manage">
          <Button variant="secondary" onClick={() => setEditing("new")}>
            {t("maint.assets.plans.add")}
          </Button>
        </Can>
      }
    >
      {plans.length === 0 ? (
        <p className="m-0 text-[14px] text-muted-foreground">{t("maint.assets.plans.empty")}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 lg:grid-cols-2">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              actions={
                <>
                  <Can do="maint.workorder">
                    {p.active && !p.openWorkOrderId ? (
                      <Button variant="secondary" size="sm" loading={make.isPending && make.variables?.planId === p.id} onClick={() => make.mutate({ planId: p.id })}>
                        {t("maint.assets.plans.makeWorkOrder")}
                      </Button>
                    ) : null}
                  </Can>
                  <Can do="maint.manage">
                    <Button variant="secondary" size="sm" onClick={() => setEditing(p)}>
                      {t("maint.assets.plans.edit")}
                    </Button>
                  </Can>
                </>
              }
            />
          ))}
        </ul>
      )}
      <Can do="maint.manage">
        <PlanSheet assetId={assetId} linked={linked} plan={editing && editing !== "new" ? editing : undefined} open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} />
      </Can>
    </Section>
  );
}

function PlanSheet({ assetId, linked, plan, open, onOpenChange }: { assetId: string; linked: boolean; plan?: PlanItem; open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PlanFormState>(emptyPlanForm);
  const [tried, setTried] = useState(false);
  useEffect(() => {
    if (open) {
      setForm(plan ? formFromPlan(plan) : emptyPlanForm());
      setTried(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const done = () => {
    void queryClient.invalidateQueries(trpc.maint.pathFilter());
    toast.success(t("maint.assets.plans.saved"));
    onOpenChange(false);
  };
  const onError = (e: unknown) => toast.error(t(maintErrorKey(e)));
  const create = useOnceMutation(trpc.maint.plans.create.mutationOptions({ onSuccess: done, onError }));
  const update = useOnceMutation(trpc.maint.plans.update.mutationOptions({ onSuccess: done, onError }));
  const busy = create.isPending || update.isPending;
  const problem = planProblem(form, linked);
  const patch = (p: Partial<PlanFormState>) => setForm((f) => ({ ...f, ...p }));
  const submit = () => {
    setTried(true);
    if (problem) return;
    const body = planPayload(form, linked);
    if (plan) update.mutate({ id: plan.id, ...body, active: form.active });
    else create.mutate({ assetId, ...body, ...(form.startOn ? { startOn: form.startOn } : {}) });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
      dismissible={!busy}
      title={plan ? t("maint.assets.plans.edit") : t("maint.assets.plans.add")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} onClick={submit}>
            {t("maint.assets.plans.save")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {tried && problem ? (
          <p role="alert" className="m-0 text-[14px] font-medium text-destructive">
            {problem === "title" ? t("maint.assets.plans.needsTitle") : t("maint.assets.plans.needsInterval")}
          </p>
        ) : null}
        <Field label={t("maint.assets.plans.planTitle")} required>
          <TextInput value={form.title} onChange={(e) => patch({ title: e.currentTarget.value })} maxLength={200} autoComplete="off" />
        </Field>
        <Field label={t("maint.assets.plans.steps")}>
          <FieldTextArea value={form.steps} onChange={(e) => patch({ steps: e.currentTarget.value })} rows={4} maxLength={2000} />
        </Field>
        <Field label={t("maint.assets.plans.days")}>
          <TextInput inputMode="numeric" value={form.days} onChange={(e) => patch({ days: e.currentTarget.value })} maxLength={5} />
        </Field>
        <Field label={t("maint.assets.plans.hours")} hint={linked ? undefined : t("maint.assets.plans.hoursNeedLink")}>
          <TextInput inputMode="numeric" value={linked ? form.hours : ""} disabled={!linked} onChange={(e) => patch({ hours: e.currentTarget.value })} maxLength={6} />
        </Field>
        {plan ? (
          <div className="flex min-h-11 items-center gap-3">
            <Checkbox id="plan-active" checked={form.active} onCheckedChange={(v) => patch({ active: v === true })} />
            <label htmlFor="plan-active" className="text-[15px] leading-5 font-medium">
              {t("maint.assets.plans.active")}
            </label>
          </div>
        ) : (
          <Field label={t("maint.assets.plans.startOn")} hint={t("maint.assets.plans.startOnHint")}>
            <TextInput type="date" value={form.startOn} onChange={(e) => patch({ startOn: e.currentTarget.value })} />
          </Field>
        )}
      </div>
    </Sheet>
  );
}
