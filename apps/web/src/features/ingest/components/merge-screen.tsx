import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { PageHeader } from "@orrn/ui/components/page-header";
import { StatusBlock } from "@orrn/ui/components/status-block";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { Can } from "@/shared/components/can";

import {
  cardLabel,
  ingestErrorWords,
  mergeView,
  useAnnouncer,
  useMergePump,
  useMergeRun,
  useStartMerge,
  type MergeItem,
  type MergeRunView,
} from "../lib";
import { FileName, ForeignText, MonoText, StatusRegion, useDocTitle, useSay } from "./list-kit";
import { ActionError, chipTone, InlineNotice, QueryPanel, ReasonText, translateKey } from "./shared";

const BLOCK_TONE = { info: "blue", success: "green", warning: "amber" } as const;

/**
 * `/ingest/merge/:runId` (work order 3.6). One status block says what is happening and how far: rows written of rows
 * planned while it runs, rows added when it is done (held imports are not counted), "Merge stopped" when it was
 * stopped. Under it one card lists the imports: held ones first, each with its reason and "Open".
 */
export function IngestMergeScreen({ runId }: { runId: string }) {
  const { t } = useT();
  const { say, words } = useSay();
  const query = useMergeRun(runId);
  const pump = useMergePump(runId);
  const view = pump.run ? mergeView(pump.run, pump.results, pump) : null;
  const title = view ? words(view.title) : null;
  useDocTitle(title ? say("ingest.docTitle.page", { name: title }) : null);
  return (
    <>
      <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={title ?? t("common.loading")} />
      <QueryPanel query={query}>{pump.run ? <MergeBody pump={pump} run={pump.run} /> : null}</QueryPanel>
    </>
  );
}

export function MergeBody({ pump, run }: { pump: ReturnType<typeof useMergePump>; run: MergeRunView }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { say, words, plant } = useSay();
  const announcer = useAnnouncer();
  const view = mergeView(run, pump.results, pump);
  const listId = useId();
  const resultRef = useRef<HTMLDivElement>(null);
  const before = useRef<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState<unknown>(null);
  const rest = useStartMerge();

  // Said and moved once, when this tab sees the run change: "started" when it opens a run in motion, and on finish
  // or stop the focus goes to the result heading (the Stop button leaves, so focus is not lost) and the counts are read.
  const { announce } = announcer;
  useEffect(() => {
    const was = before.current;
    before.current = view.phase;
    const moving = (p: string | null) => p === "planning" || p === "running";
    if (was === null && moving(view.phase)) announce(say("ingest.merge.started"));
    if (moving(was) && (view.phase === "done" || view.phase === "stopped")) {
      resultRef.current?.focus();
      if (view.announce) announce(words(view.announce));
    }
  }, [view.phase, view.announce, announce, say, words]);

  const stop = async () => {
    if (stopping) return;
    setStopping(true);
    setStopError(null);
    try {
      await pump.stop();
    } catch (error) {
      setStopError(error);
    } finally {
      setStopping(false);
    }
  };
  const mergeRest = async () => {
    if (rest.pending) return;
    try {
      const result = await rest.start();
      await navigate({ to: "/ingest/merge/$runId", params: { runId: result.runId } });
    } catch {
      // The hook keeps the error; one existing refusal line shows below the buttons.
    }
  };

  const finished = view.phase === "done" || view.phase === "stopped";
  const items: MergeItem[] = view.phase === "done" ? [...view.held, ...view.merged] : view.all;
  const status = view.status;
  const statusTitle = words(status.title);

  return (
    <>
      <StatusRegion message={announcer.message} />

      <div className="flex flex-col gap-3 sm:max-w-[360px]">
        {/* The focus target when the run ends (the Stop button leaves). A named group, not a second heading. */}
        <div ref={resultRef} role="group" tabIndex={-1} aria-label={words(view.title)} className="outline-none">
          <StatusBlock
            tone={BLOCK_TONE[status.tone]}
            title={statusTitle}
            value={status.value ?? ""}
            unit={status.unit ? words(status.unit) : undefined}
            meta={status.meta ? words(status.meta) : undefined}
            progress={status.progress ?? undefined}
            format={plant.count}
          />
        </div>
        {view.canStop ? (
          <Can do="ingest.merge">
            <Button variant="secondary" className="max-sm:w-full" aria-disabled={stopping || undefined} aria-busy={stopping || undefined} onClick={() => void stop()}>
              {t("ingest.merge.stop")}
            </Button>
          </Can>
        ) : null}
      </div>
      <ActionError error={stopError} />

      {pump.phase === "otherTab" ? <p className="m-0 text-[14px] text-muted-foreground">{t("ingest.merge.otherTab")}</p> : null}
      {pump.phase === "error" ? (
        <InlineNotice tone="danger">
          <div className="flex flex-wrap items-center gap-3">
            <span>{translateKey(t, ingestErrorWords(pump.error, "action").key)}</span>
            <Button variant="secondary" onClick={pump.retry}>
              {t("common.retry")}
            </Button>
          </div>
        </InlineNotice>
      ) : null}

      {finished ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {view.phase === "stopped" && view.mergeRest ? (
            <Can do="ingest.merge">
              <Button className="max-sm:w-full" aria-disabled={rest.pending || undefined} aria-busy={rest.pending || undefined} onClick={() => void mergeRest()}>
                {words(view.mergeRest)}
              </Button>
            </Can>
          ) : null}
          {view.back ? (
            <Button asChild variant={view.phase === "done" ? "primary" : "secondary"} className="max-sm:w-full">
              <UiLink to="/ingest">{words(view.back)}</UiLink>
            </Button>
          ) : null}
          {view.targetLinks.map((link) => (
            <Button key={link.target} asChild variant="secondary" className="max-sm:w-full">
              <UiLink to={link.to}>{words(link.words)}</UiLink>
            </Button>
          ))}
        </div>
      ) : null}
      <ActionError error={rest.rawError} />

      {items.length > 0 ? (
        <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5">
          <h2 id={listId} className="m-0 font-display text-[17px] font-bold leading-tight tracking-[-0.02em]">
            {t("ingest.merge.listTitle")}
          </h2>
          <ul className="m-0 flex list-none flex-col divide-y divide-border p-0">
            {items.map((item) => (
              <li key={item.candidateId} data-state={item.open ? "held" : "merged"} className="flex min-w-0 flex-col gap-2 py-3.5 first:pt-0 last:pb-0">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-semibold break-words">
                      {item.title.kind === "sheet" ? <ForeignText>{item.title.name}</ForeignText> : say(item.title.key)}
                    </span>
                    <FileName name={item.fileName} className="text-muted-foreground" />
                  </div>
                  <Chip tone={chipTone(item.chip.tone)} truncate={false}>
                    {words(item.chip.words)}
                  </Chip>
                </div>
                {item.counts.length > 0 ? (
                  <p className="m-0 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                    {item.counts.map((count, index) => (
                      <span key={index}>
                        <MonoText text={words(count)} />
                      </span>
                    ))}
                  </p>
                ) : null}
                {item.reason ? <ReasonText code={item.reason.code} detail={item.reason.detail} /> : null}
                {item.open ? (
                  <Button asChild variant="secondary" className="w-full self-start sm:w-auto">
                    <UiLink to={`/ingest/review/${item.candidateId}`} aria-label={cardLabel(say, t("ingest.merge.open"), { target: item.target, sheetName: item.sheetName, fileName: item.fileName })}>
                      {t("ingest.merge.open")}
                    </UiLink>
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
