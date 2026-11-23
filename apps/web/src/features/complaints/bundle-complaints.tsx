import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { TextArea } from "@orrn/ui/components/input";
import { UiLink } from "@orrn/ui/components/link";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { Sheet } from "@orrn/ui/components/sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { COMPLAINT_KINDS, COMPLAINT_STATUS_TONE, complaintErrorKey, complaintsModuleOn, isComplaintKind, isComplaintStatus, parsePiecesHit, type ComplaintKindValue } from "./model";

export type BundleComplaintRow = { id: string; number: string; period: string; status: string; kind: string; createdAt: number };

/** The complaints already raised on a bundle: number, problem, status chip, date. Pure view, so a test can render it. */
export function ComplaintRows({ rows, when }: { rows: readonly BundleComplaintRow[]; when: (at: number) => string }) {
  const { t } = useT();
  if (rows.length === 0) {
    return (
      <p className="m-0 text-[15px] text-muted-foreground" data-testid="bundle-complaints-empty">
        {t("reg.complaints.bundle.none")}
      </p>
    );
  }
  return (
    <ul className="m-0 flex list-none flex-col p-0" data-testid="bundle-complaints">
      {rows.map((r) => (
        <li key={r.id} className="border-b border-border last:border-b-0">
          <UiLink to={`/complaints/${encodeURIComponent(r.id)}`} className="flex min-h-14 min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 no-underline">
            <span className="min-w-0">
              <span className="font-mono font-semibold whitespace-nowrap">{r.number}</span>
              <span className="block text-[13px] text-muted-foreground">
                {isComplaintKind(r.kind) ? t(`reg.complaints.kind.${r.kind}`) : r.kind} · {when(r.createdAt)}
              </span>
            </span>
            {isComplaintStatus(r.status) ? (
              <Chip tone={COMPLAINT_STATUS_TONE[r.status]} truncate={false}>
                {t(`reg.complaints.status.${r.status}`)}
              </Chip>
            ) : null}
          </UiLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * The "Complaints" card on a bundle's page and its "Raise a complaint" sheet. Hidden when the plant's
 * `complaints` module is off or the person holds neither complaint action.
 */
export function BundleComplaints({ bundleId, serial, pcs }: { bundleId: string; serial: string; pcs: number }) {
  const { data: me } = useMe();
  if (!complaintsModuleOn(me?.company?.modules)) return null;
  return (
    <Can do={["complaint.open", "complaint.manage"]}>
      <ComplaintsCard bundleId={bundleId} serial={serial} pcs={pcs} />
    </Can>
  );
}

function ComplaintsCard({ bundleId, serial, pcs }: { bundleId: string; serial: string; pcs: number }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const [open, setOpen] = useState(false);
  const list = useQuery({ ...trpc.complaints.forBundle.queryOptions({ bundleId }), retry: false });
  return (
    <section aria-labelledby="bundle-complaints-title" data-testid="bundle-complaints-card" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="bundle-complaints-title" className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
          {t("reg.complaints.bundle.title")}
        </h2>
        <Can do="complaint.open">
          <Button variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" strokeWidth={2} />
            {t("reg.complaints.bundle.raise")}
          </Button>
        </Can>
      </div>
      {list.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-[15px] text-muted-foreground">
          {t("reg.complaints.bundle.loadFailed")}
          <Button variant="secondary" onClick={() => void list.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : list.data ? (
        <ComplaintRows rows={list.data} when={when} />
      ) : (
        <span className="sr-only" role="status">
          {t("common.loading")}
        </span>
      )}
      <Can do="complaint.open">
        {open ? <RaiseSheet open={open} onOpenChange={setOpen} bundleId={bundleId} serial={serial} pcs={pcs} /> : null}
      </Can>
    </section>
  );
}

function RaiseSheet({ open, onOpenChange, bundleId, serial, pcs }: { open: boolean; onOpenChange(open: boolean): void; bundleId: string; serial: string; pcs: number }) {
  const { t } = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ComplaintKindValue>("dimension");
  const [description, setDescription] = useState("");
  const [piecesText, setPiecesText] = useState("");
  const [tried, setTried] = useState(false);
  const pieces = parsePiecesHit(piecesText, pcs);
  const missing = description.trim() === "";
  const create = useMutation({
    mutationFn: (input: { kind: ComplaintKindValue; description: string; affectedPcs?: number }) => trpcClient.complaints.open.mutate({ bundleId, ...input }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: trpc.complaints.forBundle.queryKey({ bundleId }) });
      void queryClient.invalidateQueries({ queryKey: trpc.complaints.list.pathKey() });
      toast.success(t("reg.complaints.bundle.raised", { number: res.number }));
      onOpenChange(false);
      void navigate({ to: "/complaints/$id", params: { id: res.id } });
    },
    onError: (error) => toast.error(t(complaintErrorKey(error))),
  });
  const submit = () => {
    setTried(true);
    if (missing || !pieces.ok || create.isPending) return;
    create.mutate({ kind, description: description.trim(), ...(pieces.value != null ? { affectedPcs: pieces.value } : {}) });
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!create.isPending) onOpenChange(next);
      }}
      dismissible={!create.isPending}
      title={t("reg.complaints.bundle.sheetTitle")}
      description={t("reg.complaints.bundle.sheetDescription", { serial })}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="flex-1" disabled={create.isPending} onClick={() => onOpenChange(false)}>
            {t("reg.complaints.bundle.cancel")}
          </Button>
          <Can do="complaint.open">
            <Button className="flex-1" loading={create.isPending} onClick={submit}>
              {t("reg.complaints.bundle.submit")}
            </Button>
          </Can>
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
        <Field label={t("reg.complaints.bundle.kind")}>
          <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as ComplaintKindValue)}>
            {COMPLAINT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`reg.complaints.kind.${k}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("reg.complaints.bundle.description")} hint={t("reg.complaints.bundle.descriptionHint")} required error={tried && missing ? t("reg.complaints.bundle.descriptionMissing") : undefined}>
          <TextArea value={description} maxLength={2000} onChangeText={setDescription} />
        </Field>
        <Field
          label={t("reg.complaints.bundle.pieces")}
          hint={t("reg.complaints.bundle.piecesHint", { max: pcs })}
          error={!pieces.ok ? t("reg.complaints.bundle.piecesInvalid", { max: pcs }) : undefined}
        >
          <TextInput inputMode="numeric" value={piecesText} onChangeText={setPiecesText} />
        </Field>
      </form>
    </Sheet>
  );
}
