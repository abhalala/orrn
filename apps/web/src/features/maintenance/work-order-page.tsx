import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { TextArea } from "@orrn/ui/components/input";
import { Field } from "@orrn/ui/components/field";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Sheet } from "@orrn/ui/components/sheet";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { hoursMinutes, isPriority, isWoKind, isWoStatus, maintErrorKey, PRIORITY_TONE, WO_STATUS_TONE, type WoStatus } from "./model";
import { WoEditCard } from "./wo-edit-form";
import { isConflict, useInvalidateWo } from "./wo-hooks";
import { doneDraft } from "./wo-model";
import { MoveBar } from "./wo-parts";
import { SparesCard } from "./wo-spares-card";

type Wo = NonNullable<ReturnType<typeof useWo>["data"]>;
type Move = WoStatus;

function useWo(id: string) {
  return useQuery({ ...trpc.maint.workOrders.get.queryOptions({ id }), retry: false });
}

/** `/maintenance/work-orders/$id`: the facts, the moves, the edit form and the spares. */
export function WorkOrderPage({ id }: { id: string }) {
  const { t } = useT();
  const q = useWo(id);
  const back = { to: "/maintenance/work-orders", label: t("maint.workOrders.back") };
  if (q.isError && !q.data) {
    const notFound = (q.error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("maint.workOrders.title")} back={back} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={notFound ? t("maint.workOrders.detail.notFound") : t("maint.workOrders.loadFailed")}
            action={
              notFound ? undefined : (
                <Button variant="secondary" onClick={() => void q.refetch()}>
                  {t("common.retry")}
                </Button>
              )
            }
          />
        </div>
      </>
    );
  }
  if (!q.data) {
    return (
      <>
        <PageHeader title={t("maint.workOrders.title")} back={back} />
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-[120px] w-full rounded-card" />
          <Skeleton className="h-[160px] w-full rounded-card" />
        </div>
      </>
    );
  }
  return <WoBody wo={q.data} back={back} />;
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  const hid = useId();
  return (
    <section aria-labelledby={hid} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <h2 id={hid} className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{r.label}</dt>
          <dd className="m-0 mt-0.5 text-[15px] break-words whitespace-pre-wrap">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function WoBody({ wo, back }: { wo: Wo; back: { to: string; label: string } }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const status = isWoStatus(wo.status) ? wo.status : "open";
  const notYet = t("maint.workOrders.detail.notYet");
  const none = t("maint.none");
  const [ask, setAsk] = useState<"done" | "cancelled" | null>(null);
  const invalidate = useInvalidateWo();
  const queryClient = useQueryClient();

  const move = useMutation({
    mutationFn: (v: { to: Move; reason?: string; workDone?: string }) =>
      trpcClient.maint.workOrders.move.mutate({ id: wo.id, serverSeq: wo.serverSeq, to: v.to, ...(v.reason ? { reason: v.reason } : {}), ...(v.workDone ? { workDone: v.workDone } : {}) }),
    onSuccess: async (_res, v) => {
      setAsk(null);
      await invalidate();
      toast.success(t("maint.workOrders.moves.moved", { status: t(`maint.woStatus.${v.to}`) }));
    },
    onError: (error) => {
      toast.error(t(maintErrorKey(error)));
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: trpc.maint.workOrders.get.queryKey({ id: wo.id }) });
    },
  });

  const onMove = (to: Move) => {
    if (to === "done" || to === "cancelled") setAsk(to);
    else move.mutate({ to });
  };

  return (
    <>
      <PageHeader
        title={t("maint.workOrders.detail.title", { number: wo.number })}
        back={back}
        subtitle={wo.title}
        actions={
          <Chip tone={WO_STATUS_TONE[status]} truncate={false}>
            {t(`maint.woStatus.${status}`)}
          </Chip>
        }
      />
      <Section title={t("maint.workOrders.detail.facts")} testId="wo-facts">
        <Facts
          rows={[
            {
              label: t("maint.workOrders.detail.machine"),
              value: (
                <UiLink to={`/maintenance/assets/${wo.asset.id}`} className="font-semibold">
                  <span className="font-mono">{wo.asset.code}</span> {wo.asset.name}
                </UiLink>
              ),
            },
            { label: t("maint.workOrders.detail.kind"), value: isWoKind(wo.kind) ? t(`maint.woKind.${wo.kind}`) : wo.kind },
            { label: t("maint.workOrders.detail.source"), value: wo.source === "manual" || wo.source === "downtime" || wo.source === "plan" || wo.source === "reading" ? t(`maint.woSource.${wo.source}`) : wo.source },
            {
              label: t("maint.workOrders.detail.priority"),
              value: isPriority(wo.priority) ? (
                <Chip tone={PRIORITY_TONE[wo.priority]} truncate={false}>
                  {t(`maint.priority.${wo.priority}`)}
                </Chip>
              ) : (
                wo.priority
              ),
            },
            {
              label: t("maint.workOrders.detail.raised"),
              value: wo.createdByName ? t("maint.workOrders.detail.raisedBy", { when: when(wo.createdAt), name: wo.createdByName }) : when(wo.createdAt),
            },
            { label: t("maint.workOrders.detail.assigned"), value: wo.assignedName ?? t("maint.workOrders.unassigned") },
            { label: t("maint.workOrders.detail.started"), value: wo.startedAt ? when(wo.startedAt) : notYet },
            { label: t("maint.workOrders.detail.finished"), value: wo.finishedAt ? when(wo.finishedAt) : notYet },
            { label: t("maint.workOrders.detail.what"), value: wo.title },
            { label: t("maint.workOrders.detail.cause"), value: wo.cause ?? none },
            { label: t("maint.workOrders.detail.workDone"), value: wo.workDone ?? none },
            { label: t("maint.workOrders.detail.labour"), value: wo.labourMin > 0 ? hoursMinutes(wo.labourMin) : none },
            ...(wo.cancelReason ? [{ label: t("maint.workOrders.detail.cancelReason"), value: wo.cancelReason }] : []),
          ]}
        />
      </Section>

      <Can do="maint.workorder">
        {wo.moves.length > 0 ? (
          <Section title={t("maint.workOrders.moves.title")} testId="wo-move-card">
            <MoveBar moves={wo.moves} disabled={move.isPending} onMove={onMove} />
          </Section>
        ) : null}
      </Can>

      {wo.downtime ? (
        <Section title={t("maint.workOrders.detail.downtimeTitle")} testId="wo-downtime">
          <p className="m-0 text-[15px]">
            {t("maint.workOrders.detail.downtimeLine", { line: wo.downtime.lineCode, start: when(wo.downtime.startedAt) })}
            {" · "}
            {wo.downtime.stoppedAt ? t("maint.workOrders.detail.downtimeUntil", { stop: when(wo.downtime.stoppedAt) }) : t("maint.workOrders.detail.downtimeStill")}
          </p>
          {wo.downtime.note ? <p className="m-0 text-[13px] text-muted-foreground">{wo.downtime.note}</p> : null}
        </Section>
      ) : null}
      {wo.plan ? (
        <Section title={t("maint.workOrders.detail.planTitle")} testId="wo-plan">
          <p className="m-0 text-[15px] font-semibold">{wo.plan.title}</p>
          <div>
            <p className="m-0 text-xs font-medium text-muted-foreground">{t("maint.workOrders.detail.planSteps")}</p>
            <p className="m-0 mt-0.5 text-[15px] leading-6 break-words whitespace-pre-wrap">{wo.plan.steps || t("maint.workOrders.detail.planNoSteps")}</p>
          </div>
        </Section>
      ) : null}

      <Can do="maint.workorder">{status === "cancelled" ? null : <WoEditCard key={wo.serverSeq} wo={wo} />}</Can>

      <SparesCard workOrderId={wo.id} status={wo.status} spares={wo.spares} />

      {ask === "done" ? (
        <DoneSheet
          initial={doneDraft(wo.workDone)}
          busy={move.isPending}
          onClose={() => setAsk(null)}
          onSubmit={(workDone) => move.mutate({ to: "done", workDone })}
        />
      ) : null}
      {ask === "cancelled" ? <CancelSheet busy={move.isPending} onClose={() => setAsk(null)} onSubmit={(reason) => move.mutate({ to: "cancelled", reason })} /> : null}
    </>
  );
}

function AskSheet({
  title,
  subtitle,
  label,
  submit,
  submitVariant,
  cancelLabel,
  initial,
  busy,
  onClose,
  onSubmit,
  max,
}: {
  title: string;
  subtitle: string;
  label: string;
  submit: string;
  submitVariant: "primary" | "danger";
  cancelLabel: string;
  initial: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  max: number;
}) {
  const [text, setText] = useState(initial);
  const formId = useId();
  const blank = text.trim() === "";
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (blank || busy) return;
    onSubmit(text.trim());
  };
  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
      dismissible={!busy}
      title={title}
      description={subtitle}
      footer={
        <>
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button type="submit" form={formId} variant={submitVariant} disabled={blank} loading={busy}>
            {submit}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={go}>
        <Field label={label} required>
          <TextArea value={text} maxLength={max} rows={5} onChangeText={setText} />
        </Field>
      </form>
    </Sheet>
  );
}

function DoneSheet({ initial, busy, onClose, onSubmit }: { initial: string; busy: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const { t } = useT();
  return (
    <AskSheet
      title={t("maint.workOrders.done.title")}
      subtitle={t("maint.workOrders.done.subtitle")}
      label={t("maint.workOrders.done.label")}
      submit={t("maint.workOrders.done.submit")}
      submitVariant="primary"
      cancelLabel={t("common.cancel")}
      initial={initial}
      busy={busy}
      onClose={onClose}
      onSubmit={onSubmit}
      max={4000}
    />
  );
}

function CancelSheet({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (text: string) => void }) {
  const { t } = useT();
  return (
    <AskSheet
      title={t("maint.workOrders.cancel.title")}
      subtitle={t("maint.workOrders.cancel.subtitle")}
      label={t("maint.workOrders.cancel.label")}
      submit={t("maint.workOrders.cancel.submit")}
      submitVariant="danger"
      cancelLabel={t("maint.workOrders.cancel.keep")}
      initial=""
      busy={busy}
      onClose={onClose}
      onSubmit={onSubmit}
      max={500}
    />
  );
}
