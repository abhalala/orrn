import { useT } from "@orrn/i18n";
import { Button, IconButton } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { PageHeader } from "@orrn/ui/components/page-header";
import { UiLink } from "@orrn/ui/components/link";
import { UploadCloud, X } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "@tanstack/react-router";

import { Can } from "@/shared/components/can";
import { useMe } from "@/shared/lib/me";
import { instantDateText } from "@/features/purchase/format";

import {
  ACCEPT_FILES,
  approvedSummary,
  canMergeAll,
  groupCandidates,
  useCandidates,
  useDryRunQueue,
  useIngestStatus,
  useIngestUpload,
  useStartMerge,
  type UploadItem,
} from "../lib";
import { CandidateCard } from "./candidate-card";
import { InlineNotice, ProgressBar, QueryPanel, translateKey } from "./shared";

export function IngestUploadScreen() {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const status = useIngestStatus();
  const candidates = useCandidates();
  const upload = useIngestUpload();
  const merge = useStartMerge();
  const [note, setNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const [left, setLeft] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  const groups = useMemo(() => groupCandidates(list), [list]);
  const approved = approvedSummary(list);
  const processingIds = useMemo(() => list.filter((c) => c.state === "processing").map((c) => c.id), [list]);
  useDryRunQueue(processingIds);
  const activeRunId = status.data?.activeRunId ?? null;
  const timeZone = typeof me?.company?.settings?.timezone === "string" ? me.company.settings.timezone : undefined;

  const add = (files: readonly File[]) => {
    const result = upload.add(files, note || undefined);
    setLeft(result.left);
    if (result.left === 0) setNote("");
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    add(Array.from(event.dataTransfer.files));
  };
  const startMerge = async () => {
    try {
      const result = await merge.start();
      await navigate({ to: "/ingest/merge/$runId", params: { runId: result.runId } });
    } catch {
      // The hook keeps the error state. The screen shows one existing refusal key.
    }
  };

  return (
    <>
      <PageHeader
        title={t("ingest.title")}
        subtitle={t("ingest.lead")}
        actions={
          <>
            {activeRunId ? (
              <Button asChild variant="secondary">
                <UiLink to={`/ingest/merge/${activeRunId}`}>{t("ingest.state.merging")}</UiLink>
              </Button>
            ) : null}
            <Can do="ingest.merge">
              <Button
                loading={merge.pending}
                disabled={!canMergeAll(approved.count, activeRunId, true)}
                onClick={() => void startMerge()}
              >
                {t("ingest.action.mergeAll", { count: approved.count })}
              </Button>
            </Can>
          </>
        }
      />

      {status.data?.vaultReady === false ? <InlineNotice>{t("ingest.vault.off")}</InlineNotice> : null}
      {status.data?.botReady === false ? <InlineNotice>{t("ingest.helper.off")}</InlineNotice> : null}
      {merge.error ? <p role="alert" className="m-0 text-[14px] text-destructive">{t("ingest.read.failed")}</p> : null}

      <Can do="ingest.upload">
        <section aria-label={t("ingest.drop.title")} className="flex flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
          <div
            data-dragging={dragging || undefined}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
            }}
            onDrop={drop}
            className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-control/60 bg-surface-sunken/60 px-4 py-7 text-center data-dragging:border-foreground data-dragging:bg-surface-sunken"
          >
            <UploadCloud aria-hidden="true" className="size-7" />
            <h2 className="m-0 font-display text-[20px] font-bold leading-tight">{t("ingest.drop.title")}</h2>
            <p className="m-0 max-w-[440px] text-[14px] leading-6 text-muted-foreground">{t("ingest.drop.hint")}</p>
            <Button variant="secondary" onClick={() => inputRef.current?.click()} disabled={upload.busy}>
              {t("ingest.drop.choose")}
            </Button>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept={ACCEPT_FILES}
              tabIndex={-1}
              aria-hidden="true"
              className="hidden"
              onChange={(event) => {
                add(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </div>
          <Field label={`${t("common.note")} (${t("common.optional")})`}>
            <TextInput value={note} maxLength={500} onChange={(event) => setNote(event.currentTarget.value)} />
          </Field>
          {left > 0 ? <p role="status" className="m-0 text-[14px] text-tone-amber-ink">{t("ingest.drop.hint")}</p> : null}
        </section>
      </Can>

      {upload.items.length > 0 ? (
        <ul aria-label={t("ingest.title")} className="m-0 flex list-none flex-col gap-3 p-0">
          {upload.items.map((item) => (
            <UploadRow key={item.id} item={item} locale={locale} timeZone={timeZone} onRetry={() => upload.retry(item.id)} onRemove={() => upload.remove(item.id)} />
          ))}
        </ul>
      ) : null}

      <QueryPanel query={candidates}>
        {groups.length === 0 && upload.items.length === 0 ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("ingest.empty.title")} body={t("ingest.empty.body")} />
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.map((group) => (
              <section key={group.group} aria-labelledby={`ingest-group-${group.group}`} className="flex flex-col gap-3">
                <h2 id={`ingest-group-${group.group}`} className="m-0 font-display text-[21px] font-bold tracking-[-0.02em]">
                  {translateKey(t, group.key)}
                </h2>
                <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 xl:grid-cols-2">
                  {group.items.map((candidate) => (
                    <CandidateCard key={candidate.id} candidate={candidate} onDone={() => void candidates.refetch()} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </QueryPanel>
    </>
  );
}

function UploadRow({
  item,
  locale,
  timeZone,
  onRetry,
  onRemove,
}: {
  item: UploadItem;
  locale: "en" | "hi" | "gu";
  timeZone?: string;
  onRetry(): void;
  onRemove(): void;
}) {
  const { t } = useT();
  const reading = item.step === "reading";
  const sending = item.step === "sending";
  const progress = reading && item.progress?.rowsTotal
    ? item.progress.rowsRead / item.progress.rowsTotal
    : sending && item.sent?.total
      ? item.sent.rows / item.sent.total
      : null;
  const label = reading
    ? t("ingest.read.reading", { sheet: item.progress?.sheet ?? item.name, rows: item.progress?.rowsRead ?? 0 })
    : item.step === "saving"
      ? t("ingest.read.uploading")
      : sending
        ? t("ingest.state.processing")
        : item.step === "done"
          ? t("common.done")
          : item.step === "seenBefore"
            ? t("ingest.drop.seenBefore", { date: instantDateText(item.seenOn ?? 0, locale, timeZone) })
            : item.problem
              ? translateKey(t, item.problem.key, item.problem.vars)
              : t("common.loading");
  return (
    <li data-step={item.step} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] font-semibold break-words">{item.name}</p>
          <p className="m-0 text-[14px] leading-6 break-words text-muted-foreground">{label}</p>
        </div>
        <IconButton label={`${t("common.remove")}: ${item.name}`} icon={<X aria-hidden="true" />} onClick={onRemove} />
      </div>
      {["queued", "hashing", "reading", "saving", "sending"].includes(item.step) ? <ProgressBar value={progress} label={label} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        {item.artifactId && (item.step === "done" || item.step === "seenBefore") ? (
          <Button asChild size="sm" variant="secondary">
            <UiLink to={`/ingest/files/${item.artifactId}`}>{t("common.details")}</UiLink>
          </Button>
        ) : null}
        {item.step === "failed" ? <Button size="sm" onClick={onRetry}>{t("common.retry")}</Button> : null}
        {item.notStored ? <span className="text-[13px] text-muted-foreground">{t("ingest.vault.off")}</span> : null}
      </div>
    </li>
  );
}
