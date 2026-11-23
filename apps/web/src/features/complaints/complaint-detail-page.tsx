import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Checkbox } from "@orrn/ui/components/checkbox";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { UiLink } from "@orrn/ui/components/link";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useFmt } from "@/shared/lib/fmt";
import { bundleDetailPath } from "@/shared/lib/paths";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import {
  COMPLAINT_STATUS_TONE,
  complaintActions,
  complaintErrorKey,
  investigationPayload,
  isComplaintKind,
  isComplaintStatus,
  isConflict,
  readTrace,
  traceLinks,
  type TraceView,
} from "./model";

type Complaint = NonNullable<ReturnType<typeof useComplaint>["data"]>;

function useComplaint(id: string) {
  return useQuery({ ...trpc.complaints.get.queryOptions({ id }), retry: false });
}

/** `/complaints/$id`: the facts, the customer's words, the frozen trace, then the three writes. */
export function ComplaintDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const q = useComplaint(id);
  const back = { to: "/complaints", label: t("reg.complaints.back") };
  if (q.isError && !q.data) {
    const notFound = (q.error as { data?: { code?: string } }).data?.code === "NOT_FOUND";
    return (
      <>
        <PageHeader title={t("reg.complaints.title")} back={back} />
        <div role="alert" className="rounded-card border border-border bg-card">
          <EmptyState
            title={notFound ? t("reg.complaints.notFound") : t("reg.complaints.loadFailed")}
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
        <PageHeader title={t("reg.complaints.title")} back={back} />
        <div role="status" aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">{t("common.loading")}</span>
          <Skeleton className="h-[120px] w-full rounded-card" />
          <Skeleton className="h-[160px] w-full rounded-card" />
        </div>
      </>
    );
  }
  return <ComplaintBody c={q.data} back={back} />;
}

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  const hid = useId();
  return (
    <section aria-labelledby={hid} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h2 id={hid} className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
          {title}
        </h2>
        {hint ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
      </div>
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
          <dd className="m-0 mt-0.5 text-[15px] break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ComplaintBody({ c, back }: { c: Complaint; back: { to: string; label: string } }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const status = isComplaintStatus(c.status) ? c.status : "open";
  const trace = useMemo(() => readTrace(c.traceJson), [c.traceJson]);
  const actions = complaintActions(status);
  const serial = trace.bundle?.serial;

  return (
    <>
      <PageHeader
        title={t("reg.complaints.detail.title", { number: c.number })}
        back={back}
        subtitle={isComplaintKind(c.kind) ? t(`reg.complaints.kind.${c.kind}`) : c.kind}
        actions={
          <Chip tone={COMPLAINT_STATUS_TONE[status]} truncate={false}>
            {t(`reg.complaints.status.${status}`)}
          </Chip>
        }
      />
      <Section title={t("reg.complaints.detail.facts")} testId="complaint-facts">
        <Facts
          rows={[
            { label: t("reg.complaints.detail.party"), value: c.customerName ?? t("reg.complaints.detail.noParty") },
            {
              label: t("reg.complaints.detail.bundle"),
              value: serial ? (
                <UiLink to={bundleDetailPath({ serial })} className="font-mono font-semibold">
                  {serial}
                </UiLink>
              ) : (
                ""
              ),
            },
            ...(c.affectedPcs != null
              ? [{ label: t("reg.complaints.detail.pieces"), value: t("reg.complaints.detail.piecesValue", { count: c.affectedPcs }) }]
              : []),
            {
              label: t("reg.complaints.detail.opened"),
              value: c.createdByName
                ? t("reg.complaints.detail.openedBy", { when: when(c.createdAt), name: c.createdByName })
                : t("reg.complaints.detail.openedAt", { when: when(c.createdAt) }),
            },
            { label: t("reg.complaints.detail.source"), value: t(`reg.complaints.source.${c.source === "portal" ? "portal" : "staff"}`) },
          ]}
        />
      </Section>
      <Section title={t("reg.complaints.detail.words")} testId="complaint-words">
        <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{c.description}</p>
      </Section>
      <TraceCard trace={trace} />

      <Can do="complaint.manage" fallback={<ReadOnlyWork c={c} />}>
        {actions.investigate ? (
          <>
            <InvestigationForm key={c.serverSeq} c={c} />
            <ReplyForm c={c} />
            <CloseForm c={c} />
          </>
        ) : (
          <ReadOnlyWork c={c} />
        )}
      </Can>
    </>
  );
}

function TraceCard({ trace }: { trace: TraceView }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const none = t("reg.complaints.detail.traceNone");
  const links = traceLinks(trace);
  const hrefOf = (kind: string, key?: string) => links.find((l) => l.kind === kind && (key == null || l.href.endsWith(`/${encodeURIComponent(key)}`)))?.href;
  const link = (href: string | undefined, text: string) =>
    href ? (
      <UiLink to={href} className="font-mono font-semibold">
        {text}
      </UiLink>
    ) : (
      <span className="font-mono">{text}</span>
    );
  const sub = (text: string | null) => (text ? <span className="block text-[13px] text-muted-foreground">{text}</span> : null);
  const run = (r: TraceView["runs"][number]) => {
    const day = r.productionDay;
    const line = day ? (r.shiftSeq != null ? t("reg.complaints.detail.runShift", { day, shift: r.shiftSeq }) : t("reg.complaints.detail.runDay", { day })) : null;
    return (
      <li key={r.id}>
        {link(hrefOf("run", r.id), r.number)}
        {sub([r.press, line].filter(Boolean).join(" · ") || null)}
      </li>
    );
  };
  return (
    <Section title={t("reg.complaints.detail.traceTitle")} hint={t("reg.complaints.detail.traceHint")} testId="complaint-trace">
      <Facts
        rows={[
          {
            label: t("reg.complaints.detail.traceBundle"),
            value: trace.bundle ? (
              <>
                {link(hrefOf("bundle"), trace.bundle.serial)}
                {sub(trace.bundle.partyNo ? t("reg.complaints.detail.partyNo", { number: trace.bundle.partyNo }) : null)}
                {trace.bundle.packedAt ? sub(t("reg.complaints.detail.packedOn", { when: when(trace.bundle.packedAt) })) : null}
              </>
            ) : (
              none
            ),
          },
          {
            label: t("reg.complaints.detail.traceSection"),
            value: trace.section ? (
              <>
                <span className="font-mono">{trace.section.code}</span>
                {sub(trace.section.name)}
              </>
            ) : (
              none
            ),
          },
          { label: t("reg.complaints.detail.traceCopy"), value: trace.copy ? <span className="font-mono">{trace.copy.code}</span> : none },
          {
            label: t("reg.complaints.detail.traceCast"),
            value: trace.cast ? (
              <>
                <span className="font-mono">{trace.cast.number}</span>
                {sub(trace.cast.alloy)}
              </>
            ) : (
              none
            ),
          },
          {
            label: t("reg.complaints.detail.traceRuns"),
            value: trace.runs.length ? <ul className="m-0 flex list-none flex-col gap-1.5 p-0">{trace.runs.map(run)}</ul> : t("reg.complaints.detail.traceNoRuns"),
          },
          { label: t("reg.complaints.detail.traceAgeing"), value: trace.ageing ? link(hrefOf("ageing"), trace.ageing.number) : none },
          {
            label: t("reg.complaints.detail.traceOrder"),
            value: trace.order ? (
              <>
                {link(hrefOf("order"), trace.order.number)}
                {sub(trace.order.poNumber ? t("reg.complaints.detail.orderPo", { po: trace.order.poNumber }) : null)}
              </>
            ) : (
              none
            ),
          },
          {
            label: t("reg.complaints.detail.traceDispatch"),
            value: trace.dispatch ? (
              <>
                {link(hrefOf("dispatch"), trace.dispatch.code)}
                {sub(trace.dispatch.plNumber ? t("reg.complaints.detail.dispatchPl", { number: trace.dispatch.plNumber }) : null)}
                {sub(trace.dispatch.invoiceNumber ? t("reg.complaints.detail.dispatchInvoice", { number: trace.dispatch.invoiceNumber }) : null)}
              </>
            ) : (
              none
            ),
          },
        ]}
      />
    </Section>
  );
}

/** What a holder of complaint.open only (or anyone, once closed) reads: the work done so far. */
function ReadOnlyWork({ c }: { c: Complaint }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const fmt = useFmt();
  const none = t("reg.complaints.detail.traceNone");
  return (
    <>
      <Section title={t("reg.complaints.investigate.readOnly")} testId="complaint-investigation-readonly">
        <Facts
          rows={[
            { label: t("reg.complaints.investigate.rootCause"), value: c.rootCause ?? none },
            { label: t("reg.complaints.investigate.correctiveAction"), value: c.correctiveAction ?? none },
            { label: t("reg.complaints.investigate.owner"), value: c.actionOwnerName ?? t("reg.complaints.investigate.ownerNone") },
            { label: t("reg.complaints.investigate.due"), value: c.actionDue ? fmt.day(c.actionDue) : none },
            ...(c.actionDoneAt ? [{ label: t("reg.complaints.investigate.done"), value: t("reg.complaints.investigate.doneOn", { when: when(c.actionDoneAt) }) }] : []),
          ]}
        />
      </Section>
      {c.reply ? (
        <Section title={t("reg.complaints.reply.title")} testId="complaint-reply-readonly">
          <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{c.reply}</p>
          {c.repliedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.reply.by", { name: c.repliedByName ?? "", when: when(c.repliedAt) })}</p> : null}
        </Section>
      ) : null}
      {c.closedAt ? <ClosedNote c={c} /> : null}
    </>
  );
}

function ClosedNote({ c }: { c: Complaint }) {
  const { t } = useT();
  const when = useCompanyWhen();
  return (
    <Section title={t("reg.complaints.close.done")} testId="complaint-closed">
      {c.closeNote ? (
        <div>
          <p className="m-0 text-xs font-medium text-muted-foreground">{t("reg.complaints.close.noteShown")}</p>
          <p className="m-0 mt-0.5 text-[15px] leading-6 break-words whitespace-pre-wrap">{c.closeNote}</p>
        </div>
      ) : null}
      {c.closedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.close.by", { name: c.closedByName ?? "", when: when(c.closedAt) })}</p> : null}
    </Section>
  );
}

/** One write on a complaint: saves the answer into the cache, or says why not and, on a stale save, reads the row again. */
function useComplaintWrite<I>(id: string, run: (input: I) => Promise<unknown>, doneKey: "reg.complaints.investigate.saved" | "reg.complaints.reply.sent" | "reg.complaints.close.done") {
  const { t } = useT();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (row) => {
      queryClient.setQueryData(trpc.complaints.get.queryKey({ id }), row as never);
      void queryClient.invalidateQueries({ queryKey: trpc.complaints.list.pathKey() });
      toast.success(t(doneKey));
    },
    onError: (error) => {
      toast.error(t(complaintErrorKey(error)));
      if (isConflict(error)) void queryClient.invalidateQueries({ queryKey: trpc.complaints.get.queryKey({ id }) });
    },
  });
}

function InvestigationForm({ c }: { c: Complaint }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const members = useQuery(trpc.company.membersList.queryOptions());
  const [rootCause, setRootCause] = useState(c.rootCause ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(c.correctiveAction ?? "");
  const [ownerId, setOwnerId] = useState(c.actionOwnerId ?? "");
  const [due, setDue] = useState(c.actionDue ?? "");
  const [done, setDone] = useState(c.actionDoneAt != null);
  const doneId = useId();
  const save = useComplaintWrite(
    c.id,
    (input: ReturnType<typeof investigationPayload>) => trpcClient.complaints.investigate.mutate({ id: c.id, serverSeq: c.serverSeq, ...input }),
    "reg.complaints.investigate.saved",
  );
  const people = (members.data ?? []).map((m) => ({ id: m.user.id, name: m.user.name || m.user.email }));
  // The owner on the row is always a member; if the list is slow, still show them as the selected option.
  if (c.actionOwnerId && !people.some((p) => p.id === c.actionOwnerId)) people.push({ id: c.actionOwnerId, name: c.actionOwnerName ?? c.actionOwnerId });
  return (
    <Section title={t("reg.complaints.investigate.title")} hint={t("reg.complaints.investigate.hint")} testId="complaint-investigation">
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (save.isPending) return;
          save.mutate(investigationPayload({ rootCause, correctiveAction, ownerId, due, done }));
        }}
      >
        <Field label={t("reg.complaints.investigate.rootCause")}>
          <TextArea value={rootCause} maxLength={2000} onChangeText={setRootCause} />
        </Field>
        <Field label={t("reg.complaints.investigate.correctiveAction")}>
          <TextArea value={correctiveAction} maxLength={2000} onChangeText={setCorrectiveAction} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("reg.complaints.investigate.owner")}>
            <NativeSelect value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">{t("reg.complaints.investigate.ownerNone")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label={t("reg.complaints.investigate.due")}>
            <TextInput type="date" value={due} onChangeText={setDue} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Checkbox id={doneId} checked={done} onCheckedChange={(v) => setDone(v === true)} />
          <label htmlFor={doneId} className="text-[15px] font-medium">
            {t("reg.complaints.investigate.done")}
            {c.actionDoneAt ? <span className="ml-2 text-[13px] font-normal text-muted-foreground">{t("reg.complaints.investigate.doneOn", { when: when(c.actionDoneAt) })}</span> : null}
          </label>
        </div>
        {c.investigatedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.investigate.last", { name: c.investigatedByName ?? "", when: when(c.investigatedAt) })}</p> : null}
        <div>
          <Can do="complaint.manage">
            <Button type="submit" loading={save.isPending}>
              {t("reg.complaints.investigate.save")}
            </Button>
          </Can>
        </div>
      </form>
    </Section>
  );
}

function ReplyForm({ c }: { c: Complaint }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const [text, setText] = useState(c.reply ?? "");
  const send = useComplaintWrite(c.id, (reply: string) => trpcClient.complaints.reply.mutate({ id: c.id, serverSeq: c.serverSeq, reply }), "reg.complaints.reply.sent");
  const blank = text.trim() === "";
  return (
    <Section title={t("reg.complaints.reply.title")} hint={t("reg.complaints.reply.hint")} testId="complaint-reply">
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (blank || send.isPending) return;
          send.mutate(text.trim());
        }}
      >
        <Field label={t("reg.complaints.reply.label")}>
          <TextArea value={text} maxLength={4000} onChangeText={setText} />
        </Field>
        {c.repliedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.reply.by", { name: c.repliedByName ?? "", when: when(c.repliedAt) })}</p> : null}
        <div>
          <Can do="complaint.manage">
            <Button type="submit" disabled={blank} loading={send.isPending}>
              {c.reply ? t("reg.complaints.reply.again") : t("reg.complaints.reply.send")}
            </Button>
          </Can>
        </div>
      </form>
    </Section>
  );
}

function CloseForm({ c }: { c: Complaint }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const close = useComplaintWrite(c.id, (n: string) => trpcClient.complaints.close.mutate({ id: c.id, serverSeq: c.serverSeq, ...(n.trim() ? { note: n.trim() } : {}) }), "reg.complaints.close.done");
  return (
    <Section title={t("reg.complaints.close.title")} hint={t("reg.complaints.close.hint")} testId="complaint-close">
      <form
        className="flex min-w-0 flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (close.isPending) return;
          close.mutate(note);
        }}
      >
        <Field label={t("reg.complaints.close.note")}>
          <TextArea value={note} maxLength={2000} rows={3} onChangeText={setNote} />
        </Field>
        <div>
          <Can do="complaint.manage">
            <Button type="submit" variant="secondary" loading={close.isPending}>
              {t("reg.complaints.close.button")}
            </Button>
          </Can>
        </div>
      </form>
    </Section>
  );
}
