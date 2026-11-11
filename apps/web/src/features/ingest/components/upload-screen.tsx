import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { UploadCloud } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";

import { can, useMe } from "@/shared/lib/me";

import {
  ACCEPT_FILES,
  DEFAULT_LIMITS,
  foundSummary,
  progressStep,
  takeFiles,
  uploadLayout,
  uploadStrip,
  useAnnouncer,
  useArtifacts,
  useCandidates,
  useDryRunQueue,
  useFocusReturn,
  useIngestStatus,
  useIngestUpload,
} from "../lib";
import { CandidateBoard } from "./candidate-board";
import { StatusRegion, useDocTitle, useSay } from "./list-kit";
import { QueryPanel } from "./shared";
import { StagedFiles, UploadStrip } from "./upload-strip";

/**
 * `/ingest` (work order 3.1 and 3.2): the header with "Add files", the files being added, and the list of imports.
 * With nothing imported yet the page is one big drop zone. Once anything exists the zone goes and the header button
 * does the job; a file dropped anywhere on the page is still taken. Chosen files wait in a short list with the note
 * field, because the note is sent when the file starts (`artifact.begin`), so it has to be typed before.
 */
export function IngestUploadScreen() {
  const { t } = useT();
  const { data: me } = useMe();
  const { say, words, fmt } = useSay();
  const status = useIngestStatus();
  const candidates = useCandidates();
  const artifacts = useArtifacts();
  const upload = useIngestUpload();
  const announcer = useAnnouncer();
  const { announce } = announcer;
  const focus = useFocusReturn();
  const coarse = useMediaQuery("(pointer: coarse)");
  useDocTitle(t("ingest.docTitle.list"));

  const canUpload = can(me, "ingest.upload");
  const canMerge = can(me, "ingest.merge");
  const list = useMemo(() => candidates.data ?? [], [candidates.data]);
  const processingIds = useMemo(() => list.filter((c) => c.state === "processing").map((c) => c.id), [list]);
  useDryRunQueue(processingIds);
  const activeRunId = status.data?.activeRunId ?? null;
  const limit = status.data?.limits.filesPerUpload ?? DEFAULT_LIMITS.filesPerUpload;

  const [staged, setStaged] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [left, setLeft] = useState(0);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const stripId = useId();

  const strip = useMemo(() => uploadStrip(upload.items, list, fmt), [upload.items, list, fmt]);
  // While the candidates load, treat the page as having some: the big zone must not flash and then collapse.
  const hasCandidates = candidates.isLoading || candidates.isError || list.length > 0;
  const layout = uploadLayout(hasCandidates, staged.length > 0 || strip.length > 0);

  const pick = (files: readonly File[]) => {
    if (files.length === 0 || !canUpload) return;
    const { taken, left: over } = takeFiles([...staged, ...files], limit);
    setStaged(taken);
    setLeft(over.length);
    if (over.length > 0) announce(say("ingest.drop.left", { count: over.length }));
  };
  const start = () => {
    if (staged.length === 0) return;
    upload.add(staged, note.trim() || undefined);
    setStaged([]);
    setNote("");
    focus.request(["strip-heading"]);
  };
  const cancel = () => {
    setStaged([]);
    setNote("");
    setLeft(0);
    focus.request(["add-files", "choose-files"]);
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    pick(Array.from(event.dataTransfer.files));
  };

  // Say once when a file is read, refused or failed, and at 0, 25, 50, 75 and 100 percent of a long read.
  const told = useRef(new Set<string>());
  const lastShare = useRef(new Map<string, number | null>());
  useEffect(() => {
    for (const entry of strip) {
      if (entry.kind !== "upload") continue;
      if (entry.step === "reading" && typeof entry.progress === "number" && entry.words) {
        const step = progressStep(lastShare.current.get(entry.id) ?? null, entry.progress);
        lastShare.current.set(entry.id, entry.progress);
        if (step !== null) announce(`${entry.name}. ${words(entry.words)}`);
        continue;
      }
      const key = entry.found && entry.found.count > 0 ? `${entry.id}:found` : entry.step === "failed" || entry.step === "refused" || entry.step === "seenBefore" ? `${entry.id}:${entry.step}` : null;
      if (!key || told.current.has(key)) continue;
      told.current.add(key);
      if (entry.found && entry.found.count > 0) announce(`${entry.name}. ${foundSummary(say, entry.found)}`);
      else if (entry.words) announce(`${entry.name}. ${words(entry.words)}`);
    }
  }, [strip, announce, say, words]);

  const chooser = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPT_FILES}
      tabIndex={-1}
      aria-hidden="true"
      className="hidden"
      onChange={(event) => {
        pick(Array.from(event.currentTarget.files ?? []));
        event.currentTarget.value = "";
      }}
    />
  );
  const choose = () => inputRef.current?.click();
  const showStrip = staged.length > 0 || strip.length > 0;

  return (
    <div
      className="contents"
      onDragEnter={(event) => {
        if (!canUpload) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (canUpload) event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={(event) => {
        if (canUpload) drop(event);
      }}
    >
      <PageHeader
        title={t("ingest.title")}
        subtitle={t("ingest.lead")}
        actions={
          layout.headerAdd && canUpload ? (
            <Button ref={focus.ref("add-files")} variant="secondary" className="w-full md:w-auto" onClick={choose}>
              {t("ingest.drop.add")}
            </Button>
          ) : null
        }
      />
      {canUpload ? chooser : null}
      <StatusRegion message={announcer.message} />

      {status.data?.vaultReady === false ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("ingest.vault.off")}</p> : null}
      {status.data?.botReady === false ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{t("ingest.helper.off")}</p> : null}

      {canUpload && (layout.dropZone || (dragging && !showStrip)) ? (
        <div
          data-dragging={dragging || undefined}
          className="flex flex-col items-center gap-3 rounded-card border-2 border-dashed border-control/60 bg-surface-sunken/60 px-4 py-9 text-center data-dragging:border-foreground data-dragging:bg-surface-sunken"
        >
          <UploadCloud aria-hidden="true" className="size-7" />
          <h2 className="m-0 font-display text-[20px] font-bold leading-tight">{coarse ? t("ingest.drop.add") : t("ingest.drop.title")}</h2>
          <p id={hintId} className="m-0 max-w-[440px] text-[14px] leading-6 text-muted-foreground">
            {t("ingest.drop.hint")}
          </p>
          <Button ref={focus.ref("choose-files")} variant="secondary" aria-describedby={hintId} onClick={choose}>
            {t("ingest.drop.choose")}
          </Button>
        </div>
      ) : null}

      {left > 0 ? <p className="m-0 text-[14px] text-tone-amber-ink">{t("ingest.drop.left", { count: left })}</p> : null}

      {showStrip ? (
        <section className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
          <h2 id={stripId} ref={focus.ref("strip-heading")} tabIndex={-1} className="m-0 text-[14px] font-semibold outline-none">
            {t("ingest.drop.listLabel")}
          </h2>
          {staged.length > 0 ? (
            <StagedFiles
              files={staged}
              note={note}
              onNote={setNote}
              onRemove={(index) => setStaged((all) => all.filter((_, i) => i !== index))}
              onStart={start}
              onCancel={cancel}
            />
          ) : null}
          <UploadStrip entries={strip} headingId={stripId} onRetry={upload.retry} onRemove={upload.remove} />
        </section>
      ) : null}

      <QueryPanel query={candidates}>
        {list.length > 0 ? (
          <CandidateBoard
            candidates={list}
            artifacts={artifacts.data ?? []}
            activeRunId={activeRunId}
            canMerge={canMerge}
            canUpload={canUpload}
            announce={announce}
          />
        ) : !canUpload && !showStrip ? (
          <div className="rounded-card border border-border bg-card">
            <EmptyState title={t("ingest.empty.title")} body={t("ingest.empty.body")} />
          </div>
        ) : null}
      </QueryPanel>
    </div>
  );
}
