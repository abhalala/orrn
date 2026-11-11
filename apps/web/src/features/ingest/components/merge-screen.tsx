import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { PageHeader } from "@orrn/ui/components/page-header";

import { Can } from "@/shared/components/can";

import {
  candidateStateKey,
  candidateTone,
  TARGET_KEY,
  useMergePump,
  useMergeRun,
  type MergeRunView,
} from "../lib";
import { CandidateLink, chipTone, InlineNotice, Panel, ProgressBar, QueryPanel, ReasonText, translateKey } from "./shared";

export function IngestMergeScreen({ runId }: { runId: string }) {
  const { t } = useT();
  const query = useMergeRun(runId);
  const pump = useMergePump(runId);
  return (
    <>
      <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={t("ingest.title")} subtitle={t("ingest.state.merging")} />
      <QueryPanel query={query}>
        {pump.run ? <MergeBody pump={pump} run={pump.run} /> : null}
      </QueryPanel>
    </>
  );
}

export function MergeBody({ pump, run }: { pump: ReturnType<typeof useMergePump>; run: MergeRunView }) {
  const { t } = useT();
  const running = run.state === "planning" || run.state === "running";
  const doneParts = pump.chunksWritten + pump.chunksFailed;
  const progress = pump.chunksTotal > 0 ? doneParts / pump.chunksTotal : null;
  const part = Math.min(pump.chunksTotal, doneParts + 1);
  const progressLabel = run.state === "planning" || pump.chunksTotal === 0
    ? t("ingest.state.processing")
    : t("ingest.merge.running", { n: part, total: pump.chunksTotal });
  const holds = pump.results.filter((result) => result.state === "held");
  const created = pump.results.reduce((sum, result) => sum + result.rowsCreate, 0);
  const updated = pump.results.reduce((sum, result) => sum + result.rowsUpdate, 0);
  const title = run.state === "stopped"
    ? t("ingest.merge.stop")
    : run.state === "done" || run.state === "done_with_holds"
      ? t("ingest.merge.done", { created, updated })
      : t("ingest.state.merging");
  return (
    <>
      <Panel title={title}>
        {running ? <ProgressBar value={progress} label={progressLabel} /> : null}
        {pump.phase === "otherTab" ? <InlineNotice>{t("ingest.merge.otherTab")}</InlineNotice> : null}
        {pump.phase === "error" ? (
          <InlineNotice tone="danger">
            <div className="flex flex-wrap items-center gap-3">
              <span>{t("ingest.read.failed")}</span>
              <Button size="sm" variant="secondary" onClick={pump.retry}>{t("common.retry")}</Button>
            </div>
          </InlineNotice>
        ) : null}
        {!running ? <p className="m-0 text-[15px] leading-6">{t("ingest.merge.done", { created, updated })}</p> : null}
        {holds.length > 0 ? <p className="m-0 text-[15px] font-semibold text-tone-amber-ink">{t("ingest.merge.holds", { count: holds.length })}</p> : null}
        {running ? (
          <Can do="ingest.merge">
            <div><Button variant="secondary" onClick={() => void pump.stop()}>{t("ingest.merge.stop")}</Button></div>
          </Can>
        ) : null}
      </Panel>

      {pump.results.length > 0 ? (
        <Panel title={t("ingest.title")}>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {pump.results.map((result) => (
              <li key={result.candidateId} data-state={result.state} className="flex min-w-0 flex-col gap-2 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CandidateLink id={result.candidateId}>
                      {result.target ? translateKey(t, TARGET_KEY(result.target)) : result.fileName}
                    </CandidateLink>
                    <p className="m-0 text-[13px] break-words text-muted-foreground">{result.fileName}{result.sheetName ? ` · ${result.sheetName}` : ""}</p>
                  </div>
                  <Chip tone={chipTone(candidateTone(result.state))}>{translateKey(t, candidateStateKey(result.state))}</Chip>
                </div>
                <p className="m-0 font-mono text-[13px] tabular-nums text-muted-foreground">
                  {result.rowsCreate} · {result.rowsUpdate} · {result.rowsWritten}
                </p>
                <ReasonText code={result.reasonCode} detail={result.reasonDetail} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </>
  );
}
