import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field } from "@orrn/ui/components/field";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { PageHeader } from "@orrn/ui/components/page-header";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { Sheet } from "@orrn/ui/components/sheet";
import { Tabs } from "@orrn/ui/components/tabs";
import type { AppRouter } from "@orrn/server/routers/index";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { inferRouterOutputs } from "@trpc/server";
import { useState } from "react";
import { toast } from "sonner";

import { FieldTextArea } from "@/features/catalog/field-text-area";
import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc, trpcClient } from "@/shared/utils/trpc";

import { INBOX_TABS, type InboxTab } from "./search";

type InboxFile = inferRouterOutputs<AppRouter>["foundry"]["spectroInbox"]["list"][number];

const STATUSES: Record<InboxTab, ("uploading" | "pending_review" | "attached" | "dismissed")[]> = {
  waiting: ["pending_review"],
  arriving: ["uploading"],
  handled: ["attached", "dismissed"],
};
const TONE = { uploading: "blue", pending_review: "amber", attached: "green", dismissed: "neutral" } as const;

/** Whole kilobytes, at least 1: "3 kB". */
export function sizeKb(bytes: number): number {
  return Math.max(1, Math.round(bytes / 1024));
}

/** A file can be attached only once it has fully arrived and is not demo data from the simulator. */
export function canAttach(f: Pick<InboxFile, "status" | "simulated">): boolean {
  return f.status === "pending_review" && !f.simulated;
}

/**
 * `/casts/inbox` (FP-FD-12): result files the spectrometer computer sent, waiting for a person. A
 * cast.enter holder attaches a file to a melt of an existing cast, or dismisses it with a reason.
 * Nothing is attached by itself. A simulated file is marked and can only be dismissed.
 */
export function InboxScreen({ tab, onTab }: { tab: InboxTab; onTab(tab: InboxTab): void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const query = useQuery({ ...trpc.foundry.spectroInbox.list.queryOptions({ status: STATUSES[tab] }), meta: INLINE_ERROR_META });
  const [attaching, setAttaching] = useState<InboxFile | null>(null);
  const [dismissing, setDismissing] = useState<InboxFile | null>(null);

  const header = <PageHeader title={t("foundry.inbox.title")} subtitle={t("foundry.inbox.subtitle")} back={{ to: "/today", label: t("nav.today") }} />;
  if (showsQueryError(query)) {
    return (
      <>
        {header}
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={t("foundry.inbox.loadFailed")} action={<Button variant="secondary" onClick={() => void query.refetch()}>{t("common.retry")}</Button>} />
        </div>
      </>
    );
  }

  const columns: ResponsiveListColumn<InboxFile>[] = [
    {
      key: "file",
      header: t("foundry.inbox.columns.file"),
      cell: (f) => (
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-2 font-semibold">
            <span className="break-all font-mono text-[14px]">{f.fileName}</span>
            {f.simulated ? <Chip tone="blue">{t("foundry.inbox.simulated")}</Chip> : null}
          </span>
          <span className="text-[13px] text-muted-foreground">
            {t("foundry.inbox.size", { kb: sizeKb(f.sizeBytes) })}
            {f.sampleRef ? ` · ${t("foundry.inbox.sample", { ref: f.sampleRef })}` : ""}
            {f.instrument ? ` · ${t("foundry.inbox.instrument", { name: f.instrument })}` : ""}
          </span>
          {f.simulated ? <span className="text-[13px] text-muted-foreground">{t("foundry.inbox.simulatedHint")}</span> : null}
          {f.dismissReason ? <span className="text-[13px] text-muted-foreground break-words">{f.dismissReason}</span> : null}
        </span>
      ),
    },
    {
      key: "when",
      header: t("foundry.inbox.columns.when"),
      hideOnPhone: true,
      cell: (f) => (
        <span className="tabular-nums text-[14px]">
          {f.capturedAt ? t("foundry.inbox.captured", { time: when(f.capturedAt) }) : f.uploadedAt ? t("foundry.inbox.uploaded", { time: when(f.uploadedAt) }) : "-"}
        </span>
      ),
    },
    { key: "status", header: t("foundry.inbox.columns.status"), phoneWide: true, cell: (f) => <Chip tone={TONE[f.status]}>{t(`foundry.inbox.status.${f.status}`)}</Chip> },
    {
      key: "actions",
      header: t("foundry.inbox.attach"),
      headerHidden: true,
      cell: (f) =>
        f.status === "pending_review" || f.status === "uploading" ? (
          <Can do="cast.enter">
            <span className="flex flex-wrap gap-2">
              {f.status === "pending_review" ? (
                <Button size="sm" disabled={!canAttach(f)} onClick={() => setAttaching(f)} aria-haspopup="dialog" data-testid="inbox-attach">
                  {t("foundry.inbox.attach")}
                </Button>
              ) : null}
              <Button size="sm" variant="secondary" onClick={() => setDismissing(f)} aria-haspopup="dialog" data-testid="inbox-dismiss">
                {t("foundry.inbox.dismiss")}
              </Button>
            </span>
          </Can>
        ) : null,
    },
  ];

  return (
    <>
      {header}
      <Tabs
        label={t("foundry.inbox.tabs.label")}
        value={tab}
        onValueChange={(v) => onTab(v as InboxTab)}
        items={INBOX_TABS.map((id) => ({ id, label: t(`foundry.inbox.tabs.${id}`) }))}
      >
        <ResponsiveList
          rows={query.data ?? []}
          columns={columns}
          rowKey={(f) => f.id}
          loading={query.isLoading}
          label={t("foundry.inbox.title")}
          empty={<EmptyState title={t(tab === "waiting" ? "foundry.inbox.empty" : tab === "arriving" ? "foundry.inbox.emptyArriving" : "foundry.inbox.emptyHandled")} />}
        />
      </Tabs>
      <AttachSheet file={attaching} onClose={() => setAttaching(null)} />
      <DismissSheet file={dismissing} onClose={() => setDismissing(null)} />
    </>
  );
}

function useRefreshInbox() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: trpc.foundry.spectroInbox.pathKey() });
}

/** Casts per page in the attach sheet's cast picker. */
export const CAST_PAGE = 50;

/** Cast, then one of its melts: the melt picker lists the melts of an existing cast (cancelled ones left out). */
function AttachSheet({ file, onClose }: { file: InboxFile | null; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefreshInbox();
  const [castId, setCastId] = useState("");
  const [meltId, setMeltId] = useState("");
  // m-7: newest 50 first, then older pages on request, so any cast can be picked.
  const casts = useInfiniteQuery({
    queryKey: [...trpc.foundry.casts.list.queryKey(), "attach-pages"],
    queryFn: ({ pageParam }) => trpcClient.foundry.casts.list.query({ limit: CAST_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    enabled: file !== null,
    meta: INLINE_ERROR_META,
  });
  const castItems = (casts.data?.pages ?? []).flatMap((p) => p.items);
  const cast = useQuery({ ...trpc.foundry.casts.get.queryOptions({ id: castId }), enabled: file !== null && castId !== "", meta: INLINE_ERROR_META });
  const melts = (cast.data?.melts ?? []).filter((m) => m.status !== "cancelled");
  const picked = cast.data?.cast;
  const attach = useMutation(
    trpc.foundry.spectroInbox.attach.mutationOptions({
      onSuccess: () => {
        const m = melts.find((x) => x.id === meltId);
        toast.success(t("foundry.inbox.attachSheet.attached", { seq: m?.seq ?? "", cast: picked?.number ?? "" }));
        refresh();
        close();
      },
    }),
  );
  const close = () => {
    setCastId("");
    setMeltId("");
    attach.reset();
    onClose();
  };
  const values = Object.entries(file?.valuesPpm ?? {});
  return (
    <Sheet
      open={file !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("foundry.inbox.attachSheet.title", { file: file?.fileName ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" loading={attach.isPending} disabled={!file || meltId === ""} onClick={() => file && attach.mutate({ id: file.id, meltId })} data-testid="inbox-attach-confirm">
            {t("foundry.inbox.attachSheet.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("foundry.inbox.attachSheet.cast")}>
          <NativeSelect
            value={castId}
            data-testid="inbox-cast"
            onChange={(e) => {
              setCastId(e.currentTarget.value);
              setMeltId("");
            }}
          >
            <option value="">{t("foundry.inbox.attachSheet.castPick")}</option>
            {castItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.number} · {c.alloy}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {casts.hasNextPage ? (
          <div>
            <Button variant="secondary" loading={casts.isFetchingNextPage} onClick={() => void casts.fetchNextPage()} data-testid="inbox-more-casts">
              {t("foundry.inbox.attachSheet.moreCasts")}
            </Button>
          </div>
        ) : null}
        <Field label={t("foundry.inbox.attachSheet.melt")} hint={castId !== "" && cast.isSuccess && melts.length === 0 ? t("foundry.inbox.attachSheet.noMelts") : undefined}>
          <NativeSelect value={meltId} disabled={castId === "" || melts.length === 0} data-testid="inbox-melt" onChange={(e) => setMeltId(e.currentTarget.value)}>
            <option value="">{t("foundry.inbox.attachSheet.meltPick")}</option>
            {melts.map((m) => (
              <option key={m.id} value={m.id}>
                {t("foundry.inbox.attachSheet.meltLabel", { seq: m.seq })}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {values.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="m-0 text-[14px] font-semibold">{t("foundry.inbox.attachSheet.values")}</p>
            <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">{values.map(([k, v]) => `${k} ${v}`).join(", ")}</p>
          </div>
        ) : null}
        {attach.error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {attach.error.message || t("foundry.inbox.failed")}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}

function DismissSheet({ file, onClose }: { file: InboxFile | null; onClose(): void }) {
  const { t } = useT();
  const refresh = useRefreshInbox();
  const [reason, setReason] = useState("");
  const [tried, setTried] = useState(false);
  const dismiss = useMutation(
    trpc.foundry.spectroInbox.dismiss.mutationOptions({
      onSuccess: () => {
        toast.success(t("foundry.inbox.dismissSheet.dismissed"));
        refresh();
        close();
      },
    }),
  );
  const close = () => {
    setReason("");
    setTried(false);
    dismiss.reset();
    onClose();
  };
  const missing = tried && reason.trim() === "";
  return (
    <Sheet
      open={file !== null}
      onOpenChange={(o) => (o ? undefined : close())}
      title={t("foundry.inbox.dismissSheet.title", { file: file?.fileName ?? "" })}
      footer={
        <>
          <Button variant="secondary" size="lg" onClick={close}>
            {t("common.cancel")}
          </Button>
          <Button
            size="lg"
            variant="danger"
            loading={dismiss.isPending}
            data-testid="inbox-dismiss-confirm"
            onClick={() => {
              setTried(true);
              if (file && reason.trim() !== "") dismiss.mutate({ id: file.id, reason: reason.trim() });
            }}
          >
            {t("foundry.inbox.dismissSheet.confirm")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label={t("foundry.inbox.dismissSheet.reason")} error={missing ? t("foundry.inbox.dismissSheet.reasonRequired") : undefined}>
          <FieldTextArea value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} data-testid="inbox-dismiss-reason" />
        </Field>
        {dismiss.error ? (
          <p role="alert" className="m-0 rounded-card bg-tone-red-tint px-4 py-3 text-[14px] font-medium text-tone-red-ink break-words">
            {dismiss.error.message || t("foundry.inbox.failed")}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
