import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { UiLink } from "@orrn/ui/components/link";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { Sheet } from "@orrn/ui/components/sheet";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  approveAllConfirm,
  approvedSummary,
  defaultSegment,
  fileGroups,
  listSegments,
  listStatus,
  MERGE_BAR_FOCUS,
  mergeBar,
  mergeConfirm,
  useStartMerge,
  type ArtifactSummary,
  type CandidateSummary,
  type FileGroup,
  type Segment,
} from "../lib";
import { FileGroupHeading } from "./candidate-card";
import { FileName, ForeignText, ImportGroups, MonoText, useListActions, useSay } from "./list-kit";
import { ActionError, IngestBar } from "./shared";

/**
 * The list under the header (work order 3.2): one status block, four segments, the imports grouped by file, and the
 * sticky merge bar once something is approved. It reads the view models of `../lib` and draws them.
 */
export function CandidateBoard({
  candidates,
  artifacts,
  activeRunId,
  canMerge,
  canUpload,
  announce,
  initialSegment,
}: {
  candidates: readonly CandidateSummary[];
  artifacts: readonly ArtifactSummary[];
  activeRunId: string | null;
  canMerge: boolean;
  canUpload: boolean;
  announce: (text: string) => void;
  /** The segment to start on. By default Needs you when it has anything, else Ready. */
  initialSegment?: Segment;
}) {
  const { t } = useT();
  const navigate = useNavigate();
  const { say, words, plant, fmt } = useSay();
  const can = { merge: canMerge, upload: canUpload };
  const segments = listSegments(candidates);
  const [choice, setChoice] = useState<Segment | null>(initialSegment ?? null);
  const active = choice ?? defaultSegment(segments);
  const groups = fileGroups(candidates, active, artifacts, can, fmt);
  const visibleIds = groups.flatMap((g) => g.rows.map((r) => r.id));
  const approved = approvedSummary(candidates);
  const { controls, error, runner, focus, actions } = useListActions({ visibleIds, approvedCount: approved.count, announce });
  const status = listStatus(candidates, fmt);
  const bar = mergeBar(candidates, activeRunId, canMerge, fmt);

  const merge = useStartMerge();
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [bulk, setBulk] = useState<FileGroup | null>(null);

  const startMerge = async () => {
    if (merge.pending) return;
    try {
      const result = await merge.start();
      announce(say("ingest.merge.started"));
      setConfirmMerge(false);
      await navigate({ to: "/ingest/merge/$runId", params: { runId: result.runId } });
    } catch {
      // The hook keeps the error; the sheet shows one existing refusal line.
    }
  };

  const approveAll = async () => {
    const eligible = bulk?.approveAll;
    if (!bulk || !eligible) return;
    const ids = new Set(eligible.ids);
    const items = bulk.rows.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, serverSeq: r.candidate.serverSeq }));
    let result: { approved: string[]; failed: unknown[] } = { approved: [], failed: [] };
    const ok = await runner.run("bulk", async () => {
      result = await actions.approveMany(items);
    });
    if (!ok) return;
    setBulk(null);
    announce(
      result.failed.length > 0
        ? say("ingest.imports.bulkPartial", { count: result.approved.length, failed: result.failed.length })
        : say("ingest.action.approvedSoFar", { count: approved.count + result.approved.length }),
    );
    focus.request([MERGE_BAR_FOCUS]);
  };

  const confirm = confirmMerge ? mergeConfirm(candidates, fmt) : null;
  const bulkWords = bulk ? approveAllConfirm(bulk) : null;

  return (
    <>
      {status ? (
        <StatusBlock
          tone={status.tone === "success" ? "green" : "amber"}
          title={t(status.titleKey)}
          value={status.value}
          unit={words(status.unit)}
          meta={status.meta ? words(status.meta) : undefined}
          format={plant.count}
          className="sm:max-w-[360px]"
        />
      ) : null}

      <SegmentedControl
        label={t("ingest.list.segments")}
        value={active}
        onChange={(next) => {
          setChoice(next);
          // The list swaps under the control; a screen reader hears what it now shows, once (WCAG 4.1.3).
          announce(say("ingest.list.showing", { name: say(`ingest.group.${next}`), count: segments.find((s) => s.id === next)?.count ?? 0 }));
        }}
        options={segments.map((s) => ({ value: s.id, label: `${say(s.labelKey)}\n${plant.count(s.count)}` }))}
      />

      <ActionError error={error} />

      {groups.length === 0 ? (
        <div className="rounded-card border border-border bg-card">
          <EmptyState title={say("ingest.imports.emptySegment", { name: say(`ingest.group.${active}`) })} />
        </div>
      ) : (
        <ImportGroups
          groups={groups}
          label={t("ingest.title")}
          controls={controls}
          heading={(group) => <FileGroupHeading group={group} controls={controls} onApproveAll={setBulk} />}
        />
      )}

      {bar.show ? (
        <IngestBar summary={bar.summary ? <p className="m-0 text-[14px] leading-5 font-medium">{words(bar.summary)}</p> : undefined}>
          {bar.running ? (
            <Button asChild variant="secondary" size="lg">
              <UiLink ref={focus.ref(MERGE_BAR_FOCUS)} to={`/ingest/merge/${bar.running.runId}`}>
                {t("ingest.action.merging")}
              </UiLink>
            </Button>
          ) : bar.merge ? (
            <Button ref={focus.ref(MERGE_BAR_FOCUS)} size="lg" onClick={() => setConfirmMerge(true)}>
              {words(bar.merge.words)}
            </Button>
          ) : null}
        </IngestBar>
      ) : bar.hint ? (
        <p className="m-0 text-[14px] text-muted-foreground">{words(bar.hint)}</p>
      ) : null}

      {confirm ? (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open && !merge.pending) setConfirmMerge(false);
          }}
          title={words(confirm.title)}
          description={words(confirm.note)}
          footer={
            <>
              <Button variant="secondary" aria-disabled={merge.pending || undefined} onClick={() => !merge.pending && setConfirmMerge(false)}>
                {t("ingest.merge.notYet")}
              </Button>
              <Button aria-disabled={merge.pending || undefined} aria-busy={merge.pending || undefined} onClick={() => void startMerge()}>
                {say("ingest.action.mergeAll", { count: confirm.items.length })}
              </Button>
            </>
          }
        >
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {confirm.items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-col gap-1 py-3 first:pt-0">
                <span className="text-[15px] font-semibold break-words">
                  {item.title.kind === "sheet" ? <ForeignText>{item.title.name}</ForeignText> : say(item.title.key)}
                </span>
                <FileName name={item.fileName} className="text-muted-foreground" />
                <span className="text-[13px] text-muted-foreground">
                  <MonoText text={`${say("ingest.list.colNew")} ${item.create}, ${say("ingest.list.colUpdates")} ${item.update}`} />
                </span>
              </li>
            ))}
          </ul>
          <div className="pt-3">
            <ActionError error={merge.rawError} />
          </div>
        </Sheet>
      ) : null}

      {bulkWords ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !runner.busy) setBulk(null);
          }}
          title={words(bulkWords.title)}
          description={words(bulkWords.body)}
          actions={
            <>
              <Button variant="secondary" aria-disabled={runner.busy || undefined} onClick={() => !runner.busy && setBulk(null)}>
                {t("common.cancel")}
              </Button>
              <Button aria-disabled={runner.busy || undefined} aria-busy={runner.busy || undefined} onClick={() => void approveAll()}>
                {words(bulkWords.confirm)}
              </Button>
            </>
          }
        >
          <ActionError error={error} />
        </Dialog>
      ) : null}
    </>
  );
}
