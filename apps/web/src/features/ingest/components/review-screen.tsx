import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";
import { UiLink } from "@orrn/ui/components/link";
import { useEffect, useRef, useState } from "react";

import {
  candidateStateKey,
  candidateTone,
  fitDiffView,
  fitKeyOf,
  helperOffer,
  ingestErrorWords,
  TARGET_KEY,
  useBotPump,
  useCandidate,
  useDryRunPump,
  useIngestActions,
  useIngestStatus,
  type CandidateDetail,
} from "../lib";
import { CandidateActions } from "./candidate-card";
import { MappingEditor } from "./mapping-editor";
import { PeriodPanel } from "./period-panel";
import { QuestionsPanel } from "./questions-panel";
import { StagedRows } from "./rows-table";
import { ActionError, chipTone, InlineNotice, Panel, ProgressBar, QueryPanel, ReasonText, translateKey } from "./shared";

export function IngestReviewScreen({ candidateId }: { candidateId: string }) {
  const { t } = useT();
  const candidate = useCandidate(candidateId);
  const data = candidate.data;
  return (
    <>
      <PageHeader
        back={{ to: "/ingest", label: t("ingest.title") }}
        title={data?.target ? translateKey(t, TARGET_KEY(data.target)) : data?.fileName ?? t("ingest.title")}
        subtitle={data ? `${data.fileName}${data.sheetName ? ` · ${data.sheetName}` : ""}` : t("ingest.lead")}
      />
      <QueryPanel query={candidate}>
        {data ? <ReviewBody candidate={data} onChanged={() => void candidate.refetch()} /> : null}
      </QueryPanel>
    </>
  );
}

function ReviewBody({ candidate, onChanged }: { candidate: CandidateDetail; onChanged: () => void }) {
  const { t } = useT();
  const dryRun = useDryRunPump(candidate.id);
  const [manual, setManual] = useState(false);
  const showRows = !["needs_confirm", "needs_shape", "discarded"].includes(candidate.state) && candidate.counts.total > 0;
  return (
    <>
      <Panel title={translateKey(t, candidateStateKey(candidate.state))}>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={chipTone(candidateTone(candidate.state))}>{translateKey(t, candidateStateKey(candidate.state))}</Chip>
          <Chip tone="neutral">{translateKey(t, fitKeyOf(candidate.fit))}</Chip>
          {candidate.holeName ? <span className="text-[14px] text-muted-foreground">{candidate.holeName}</span> : null}
        </div>
        <ReasonText code={candidate.reasonCode} detail={candidate.reasonDetail} />
        {candidate.state === "failed" && !candidate.reasonCode ? <InlineNotice tone="danger">{t("ingest.read.failed")}</InlineNotice> : null}
        {candidate.block.readBy === "model" && candidate.block.modelChecked ? <p className="m-0 text-[14px]">{t("ingest.vision.check")}</p> : null}
        <CandidateActions candidate={candidate} onDone={onChanged} />
        {candidate.state === "merged" ? (
          <div>
            <Button asChild size="sm" variant="secondary">
              <UiLink to={`/ingest/files/${candidate.artifactId}`}>{t("common.details")}</UiLink>
            </Button>
          </div>
        ) : null}
      </Panel>

      {candidate.state === "processing" ? <DryRunState candidate={candidate} dryRun={dryRun} /> : null}
      {candidate.state === "needs_confirm" ? <NearFit candidate={candidate} onChanged={onChanged} /> : null}
      {candidate.state === "needs_shape" ? (
        <ShapeState candidate={candidate} manual={manual} setManual={setManual} onChanged={onChanged} />
      ) : null}

      <PeriodPanel key={candidate.artifactId} artifactId={candidate.artifactId} period={candidate.period} confirmed={candidate.periodConfirmed} />
      <QuestionsPanel candidate={candidate} onSaved={onChanged} />
      {showRows ? <StagedRows key={`${candidate.id}:${candidate.serverSeq}`} candidate={candidate} onChanged={onChanged} /> : null}
    </>
  );
}

function DryRunState({ candidate, dryRun }: { candidate: CandidateDetail; dryRun: ReturnType<typeof useDryRunPump> }) {
  const { t } = useT();
  if (dryRun.phase === "otherTab") return <InlineNotice>{t("ingest.merge.otherTab")}</InlineNotice>;
  if (dryRun.phase === "error") {
    return (
      <InlineNotice tone="danger">
        <div className="flex flex-wrap items-center gap-3">
          <span>{translateKey(t, ingestErrorWords(dryRun.error, "action").key)}</span>
          <Button size="sm" variant="secondary" onClick={dryRun.retry}>{t("common.retry")}</Button>
        </div>
      </InlineNotice>
    );
  }
  const label = dryRun.rowsMissing > 0 ? t("ingest.read.uploading") : t("ingest.state.processing");
  return (
    <Panel title={t("ingest.state.processing")}>
      <ProgressBar value={dryRun.rowsMissing > 0 ? null : dryRun.progress} label={label} />
      {dryRun.stalled ? <InlineNotice tone="danger">{t("ingest.read.stalled")}</InlineNotice> : null}
      <span className="sr-only">{candidate.rowsMissing}</span>
    </Panel>
  );
}

function NearFit({ candidate, onChanged }: { candidate: CandidateDetail; onChanged: () => void }) {
  const { t } = useT();
  const actions = useIngestActions();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const diff = fitDiffView(candidate.fitDiff);
  const confirm = async (accept: boolean) => {
    setPending(true);
    setFailed(null);
    try {
      await actions.confirmNear(candidate.id, accept, candidate.serverSeq);
      onChanged();
    } catch (error) {
      setFailed(error);
    } finally {
      setPending(false);
    }
  };
  return (
    <Panel title={t("ingest.near.title", { name: diff.name ?? candidate.holeName ?? candidate.fileName, count: diff.renamed.length + diff.extra.length + diff.missing.length })}>
      {diff.renamed.length + diff.extra.length + diff.missing.length > 0 ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-[14px] leading-6">
          {diff.renamed.map((item) => <li key={`${item.old}:${item.new}`}>{t("ingest.near.renamed", { old: item.old, new: item.new })}</li>)}
          {diff.extra.map((item) => <li key={`extra:${item.header}`}>{t("ingest.near.extra", { name: item.header })}</li>)}
          {diff.missing.map((item) => <li key={`missing:${item.header}`}>{t("ingest.near.missing", { name: item.header })}</li>)}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={pending} onClick={() => void confirm(true)}>{t("ingest.near.use")}</Button>
        <Button variant="secondary" disabled={pending} onClick={() => void confirm(false)}>{t("ingest.near.reject")}</Button>
      </div>
      <ActionError error={failed} />
    </Panel>
  );
}

function ShapeState({
  candidate,
  manual,
  setManual,
  onChanged,
}: {
  candidate: CandidateDetail;
  manual: boolean;
  setManual(value: boolean): void;
  onChanged: () => void;
}) {
  const { t } = useT();
  const status = useIngestStatus();
  const bot = useBotPump(candidate.id);
  const actions = useIngestActions();
  const [ignorePending, setIgnorePending] = useState(false);
  const [ignoreError, setIgnoreError] = useState<unknown>(null);
  const manualButtonRef = useRef<HTMLButtonElement>(null);
  const offer = helperOffer(candidate, status.data?.botReady ?? false);

  useEffect(() => {
    if (bot.phase === "gaveUp" || bot.phase === "capped") setManual(true);
  }, [bot.phase, setManual]);

  const ignore = async () => {
    setIgnorePending(true);
    setIgnoreError(null);
    try {
      await actions.setTarget(candidate.id, "ignore", candidate.serverSeq);
      onChanged();
    } catch (error) {
      setIgnoreError(error);
    } finally {
      setIgnorePending(false);
    }
  };

  return (
    <>
      <Panel title={t("ingest.state.needs_shape")}>
        {offer === "off" ? <InlineNotice>{t("ingest.helper.off")}</InlineNotice> : null}
        {bot.phase === "working" ? <ProgressBar value={null} label={t("ingest.shape.working", { n: bot.attempt })} /> : null}
        {bot.phase === "otherTab" ? <InlineNotice>{t("ingest.merge.otherTab")}</InlineNotice> : null}
        {bot.phase === "gaveUp" ? <InlineNotice>{t("ingest.shape.gaveUp")}</InlineNotice> : null}
        {bot.phase === "capped" ? <InlineNotice>{t("ingest.shape.capped")}</InlineNotice> : null}
        {bot.phase === "error" ? <InlineNotice tone="danger">{translateKey(t, ingestErrorWords(bot.error, "action").key)}</InlineNotice> : null}
        <div className="flex flex-wrap gap-2">
          {offer === "auto" ? (
            <Button loading={bot.phase === "working"} onClick={bot.start}>{t("ingest.shape.auto")}</Button>
          ) : null}
          <Button
            ref={manualButtonRef}
            variant="secondary"
            onClick={() => {
              if (manual) manualButtonRef.current?.focus();
              setManual(!manual);
            }}
          >
            {t("ingest.shape.manual")}
          </Button>
          <Button
            variant="ghost"
            loading={ignorePending}
            onClick={() => void ignore()}
          >
            {t("ingest.shape.ignore")}
          </Button>
        </div>
        <ActionError error={ignoreError} />
      </Panel>
      {manual ? <MappingEditor candidate={candidate} onSaved={onChanged} /> : null}
    </>
  );
}
