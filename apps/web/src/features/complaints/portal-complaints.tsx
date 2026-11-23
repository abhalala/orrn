import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { PortalError, PortalSkeleton } from "@/features/portal/ui";
import { useFmt } from "@/shared/lib/fmt";
import { whenText } from "@/shared/lib/fmt-text";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { COMPLAINT_KINDS, COMPLAINT_STATUS_TONE, isComplaintKind, isComplaintStatus, parsePiecesHit, portalCreateErrorKey, type ComplaintKindValue } from "./model";

const STEP = 20;

function StatusChip({ status }: { status: string }) {
  const { t } = useT();
  return isComplaintStatus(status) ? (
    <Chip tone={COMPLAINT_STATUS_TONE[status]} truncate={false}>
      {t(`reg.complaints.status.${status}`)}
    </Chip>
  ) : (
    <>{status}</>
  );
}

/** `/portal/complaints`: this party's complaints and the "Raise a complaint" form. */
export function PortalComplaintsPage() {
  const { t } = useT();
  const fmt = useFmt();
  const [limit, setLimit] = useState(STEP);
  const [open, setOpen] = useState(false);
  const list = useQuery({ ...trpc.portal.complaints.list.queryOptions({ limit }), placeholderData: keepPreviousData, retry: false });
  type Row = NonNullable<typeof list.data>["items"][number];

  const columns: ResponsiveListColumn<Row>[] = [
    { key: "number", header: t("reg.complaints.portal.number"), cell: (c) => <span className="font-mono font-semibold whitespace-nowrap">{c.number}</span> },
    { key: "bundle", header: t("reg.complaints.portal.bundle"), cell: (c) => <span className="font-mono whitespace-nowrap">{c.bundleNo ?? ""}</span> },
    { key: "kind", header: t("reg.complaints.portal.kindLabel"), hideOnPhone: true, cell: (c) => (isComplaintKind(c.kind) ? t(`reg.complaints.kind.${c.kind}`) : c.kind) },
    { key: "status", header: t("reg.complaints.portal.status"), phoneWide: true, cell: (c) => <StatusChip status={c.status} /> },
    { key: "date", header: t("reg.complaints.portal.raisedOn"), hideOnPhone: true, cell: (c) => <span className="whitespace-nowrap">{fmt.date(c.createdAt, { year: true })}</span> },
  ];

  return (
    <>
      <PageHeader
        title={t("reg.complaints.portal.title")}
        subtitle={t("reg.complaints.portal.subtitle")}
        actions={
          <Button size="lg" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("reg.complaints.portal.raise")}
          </Button>
        }
      />
      {list.isError && !list.data ? (
        <PortalError error={list.error} onRetry={() => void list.refetch()} />
      ) : (
        <>
          <ResponsiveList<Row>
            label={t("reg.complaints.portal.title")}
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(c) => c.id}
            rowHref={(c) => `/portal/complaints/${c.id}`}
            loading={list.isPending}
            empty={<EmptyState title={t("reg.complaints.portal.empty")} />}
          />
          {(list.data?.items.length ?? 0) >= limit ? (
            <div>
              <Button variant="secondary" onClick={() => setLimit((n) => n + STEP)}>
                {t("reg.complaints.showMore")}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {open ? <RaiseSheet open={open} onOpenChange={setOpen} /> : null}
    </>
  );
}

function RaiseSheet({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const { t } = useT();
  const fmt = useFmt();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [bundleNo, setBundleNo] = useState("");
  const [dispatchId, setDispatchId] = useState("");
  const [kind, setKind] = useState<ComplaintKindValue>("dimension");
  const [description, setDescription] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [tried, setTried] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);

  const dispatches = useQuery({ ...trpc.portal.dispatches.list.queryOptions({ limit: 50 }), enabled: open, retry: false });
  const picked = useQuery({ ...trpc.portal.dispatches.get.queryOptions({ id: dispatchId }), enabled: open && dispatchId !== "", retry: false });

  const pieces = parsePiecesHit(piecesText);
  const noBundle = bundleNo.trim() === "";
  const noWords = description.trim() === "";
  const create = useMutation({
    mutationFn: (input: { bundleNo: string; kind: ComplaintKindValue; description: string; affectedPcs?: number }) => trpcClient.portal.complaints.create.mutate(input),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: trpc.portal.complaints.list.pathKey() });
      toast.success(t("reg.complaints.portal.sent", { number: res.number }));
      onOpenChange(false);
      void navigate({ to: "/portal/complaints/$id" as never, params: { id: res.id } as never });
    },
    onError: (error) => setRefused(t(portalCreateErrorKey(error))),
  });
  const submit = () => {
    setTried(true);
    setRefused(null);
    if (noBundle || noWords || !pieces.ok || create.isPending) return;
    create.mutate({ bundleNo: bundleNo.trim(), kind, description: description.trim(), ...(pieces.value != null ? { affectedPcs: pieces.value } : {}) });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
      dismissible={!create.isPending}
      title={t("reg.complaints.portal.formTitle")}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" disabled={create.isPending} onClick={() => onOpenChange(false)}>
            {t("reg.complaints.portal.cancel")}
          </Button>
          <Button className="flex-1" loading={create.isPending} onClick={submit}>
            {t("reg.complaints.portal.send")}
          </Button>
        </div>
      }
    >
      <form
        className="flex min-w-0 flex-col gap-4 pb-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {refused ? (
          <p role="alert" className="m-0 rounded-card border border-border bg-card p-3 text-[15px] font-medium">
            {refused}
          </p>
        ) : null}
        <Field label={t("reg.complaints.portal.bundleNo")} hint={t("reg.complaints.portal.bundleHint")} required error={tried && noBundle ? t("reg.complaints.portal.bundleMissing") : undefined}>
          <TextInput value={bundleNo} onChangeText={setBundleNo} autoCapitalize="characters" autoComplete="off" />
        </Field>
        {dispatches.data && dispatches.data.items.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-3">
            <Field label={t("reg.complaints.portal.pickDispatch")}>
              <NativeSelect
                value={dispatchId}
                onChange={(e) => {
                  setDispatchId(e.target.value);
                }}
              >
                <option value="">{t("reg.complaints.portal.pickDispatchNone")}</option>
                {dispatches.data.items.map((d) => (
                  <option key={d.id} value={d.id}>
                    {t("reg.complaints.portal.dispatchOption", { code: d.code, date: d.shipDay?.ymd ? fmt.day(d.shipDay.ymd) : "" })}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {dispatchId && picked.data ? (
              <Field label={t("reg.complaints.portal.pickBundle")}>
                <NativeSelect value="" onChange={(e) => e.target.value && setBundleNo(e.target.value)}>
                  <option value="">{t("reg.complaints.portal.pickBundleNone")}</option>
                  {picked.data.bundles.map((b) => (
                    <option key={b.bundleNo} value={b.bundleNo}>
                      {t("reg.complaints.portal.bundleOption", { number: b.bundleNo, section: [b.series, b.sectionCode].filter(Boolean).join(" ") })}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
          </div>
        ) : null}
        <Field label={t("reg.complaints.portal.kind")}>
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ComplaintKindValue)}>
            {COMPLAINT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`reg.complaints.kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("reg.complaints.portal.description")} hint={t("reg.complaints.portal.descriptionHint")} required error={tried && noWords ? t("reg.complaints.portal.descriptionMissing") : undefined}>
          <TextArea value={description} maxLength={2000} onChangeText={setDescription} />
        </Field>
        <Field label={t("reg.complaints.portal.pieces")} error={!pieces.ok ? t("reg.complaints.portal.piecesInvalid") : undefined}>
          <TextInput inputMode="numeric" value={piecesText} onChangeText={setPiecesText} />
        </Field>
      </form>
    </Sheet>
  );
}

/** `/portal/complaints/$id`: number, status, kind, bundle, the party's words and the plant's reply. Nothing of the investigation. */
export function PortalComplaintDetailPage({ id }: { id: string }) {
  const { t } = useT();
  const fmt = useFmt();
  const q = useQuery({ ...trpc.portal.complaints.get.queryOptions({ id }), retry: false });
  const back = { to: "/portal/complaints", label: t("reg.complaints.portal.back") };
  if (q.isError) {
    return (
      <>
        <PageHeader title={t("reg.complaints.portal.title")} back={back} />
        <PortalError error={q.error} onRetry={() => void q.refetch()} />
      </>
    );
  }
  const c = q.data;
  if (!c) {
    return (
      <>
        <PageHeader title={t("reg.complaints.portal.title")} back={back} />
        <PortalSkeleton />
      </>
    );
  }
  const when = (ms: number) => whenText(fmt, ms);
  return (
    <>
      <PageHeader title={c.number} back={back} subtitle={isComplaintKind(c.kind) ? t(`reg.complaints.kind.${c.kind}`) : c.kind} actions={<StatusChip status={c.status} />} />
      <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4" data-testid="portal-complaint-facts">
        <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("reg.complaints.portal.bundle")}</dt>
            <dd className="m-0 mt-0.5 font-mono text-[15px] break-all">{c.bundleNo ?? ""}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-muted-foreground">{t("reg.complaints.portal.raisedOn")}</dt>
            <dd className="m-0 mt-0.5 text-[15px]">{when(c.createdAt)}</dd>
          </div>
          {c.affectedPcs != null ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">{t("reg.complaints.portal.pieces2")}</dt>
              <dd className="m-0 mt-0.5 text-[15px]">{t("reg.complaints.detail.piecesValue", { count: c.affectedPcs })}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-testid="portal-complaint-words">
        <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("reg.complaints.portal.yourWords")}</h2>
        <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{c.description}</p>
      </section>
      <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-testid="portal-complaint-reply">
        <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("reg.complaints.portal.plantReply")}</h2>
        {c.reply ? (
          <>
            <p className="m-0 text-[15px] leading-6 break-words whitespace-pre-wrap">{c.reply}</p>
            {c.repliedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.portal.repliedOn", { when: when(c.repliedAt) })}</p> : null}
          </>
        ) : (
          <p className="m-0 text-[15px] text-muted-foreground">{t("reg.complaints.portal.noReply")}</p>
        )}
        {c.closedAt ? <p className="m-0 text-[13px] text-muted-foreground">{t("reg.complaints.portal.closedOn", { when: when(c.closedAt) })}</p> : null}
      </section>
    </>
  );
}
