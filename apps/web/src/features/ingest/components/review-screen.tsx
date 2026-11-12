import { PageHeader } from "@orrn/ui/components/page-header";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { can, useMe } from "@/shared/lib/me";

import {
  afterDecision,
  approvedSummary,
  classifiedRows,
  decisionBar,
  helperOffer,
  nextNeedsYou,
  progressStep,
  questionList,
  readPanel,
  reviewDocTitle,
  reviewHeader,
  useAnnouncer,
  useBotPump,
  useCandidate,
  useCandidates,
  useDiscardFlow,
  useDryRunPump,
  useFocusReturn,
  useIngestStatus,
  usePlantUnits,
  yearLine,
  ingestErrorWords,
  type BarActionId,
  type CandidateDetail,
} from "../lib";
import { BarButtons, DecisionBarCard, DiscardDialog, HoldSheet, type BarPress } from "./decision-bar";
import { MappingEditor } from "./mapping-editor";
import { YearLine } from "./period-panel";
import { QuestionsPanel } from "./questions-panel";
import { ReadPanel } from "./read-panel";
import { Muted, useSay, useScrolledOut } from "./review-bits";
import { StagedRows, type RowsHandle } from "./rows-table";
import { IngestBar, InlineNotice, ProgressBar, QueryPanel } from "./shared";
import { FOCUS, questionSentenceKey, useReviewActions } from "./use-review-actions";

const EDITOR_ID = "review-mapping-editor";

export function IngestReviewScreen({ candidateId }: { candidateId: string }) {
  const { t, say } = useSay();
  const plant = usePlantUnits();
  const candidate = useCandidate(candidateId);
  const data = candidate.data;
  const announcer = useAnnouncer();

  // The tab title names the import: "Sections, dies.csv | Imports | orrn".
  useEffect(() => {
    document.title = data ? reviewDocTitle(say, data) : t("ingest.docTitle.list");
  }, [data, say, t]);

  const header = data ? reviewHeader(data) : null;
  const title = header
    ? header.title.kind === "target"
      ? t(header.title.key as never)
      : header.title.kind === "sheet"
        ? header.title.name
        : t("ingest.list.newTable")
    : null;
  const subtitle = header
    ? [
        header.fileName,
        header.title.kind === "target" ? header.sheetName : null,
        t("ingest.file.rows", { count: plant.count(header.rows) }),
        t("ingest.file.columns", { count: plant.count(header.columns) }),
      ]
        .filter((part): part is string => Boolean(part && part.trim() !== ""))
        .join(" · ")
    : undefined;

  return (
    <>
      {title !== null ? (
        <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={title} subtitle={subtitle} />
      ) : candidate.isLoading ? (
        <LoadingHeader />
      ) : (
        <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={t("ingest.title")} />
      )}
      {/* The one polite status region of the page: mounted empty, filled only when something changed. */}
      <p role="status" aria-live="polite" className="sr-only">{announcer.message}</p>
      <QueryPanel query={candidate}>
        {data ? <ReviewBody key={data.id} candidate={data} announce={announcer.announce} /> : null}
      </QueryPanel>
    </>
  );
}

/** While the import loads, a skeleton stands where the title will be. The h1 is there for screen readers. */
function LoadingHeader() {
  const { t } = useSay();
  return (
    <>
      <PageHeader back={{ to: "/ingest", label: t("ingest.title") }} title={t("common.loading")} className="[&_h1]:sr-only" />
      <Skeleton className="h-9 w-2/5 max-w-[360px]" />
    </>
  );
}

function ReviewBody({ candidate, announce }: { candidate: CandidateDetail; announce: (text: string) => void }) {
  const { t, words } = useSay();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const plant = usePlantUnits();
  const status = useIngestStatus();
  const list = useCandidates();
  const focus = useFocusReturn();
  const dryRun = useDryRunPump(candidate.id);
  const bot = useBotPump(candidate.id);
  const [editorOpen, setEditorOpen] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const rowsRef = useRef<RowsHandle>(null);
  const [scrolledRef, scrolledOut] = useScrolledOut();

  const canUpload = can(me, "ingest.upload");
  const canMerge = can(me, "ingest.merge");
  const canSeePrices = can(me, "order.price");
  const botReady = status.data?.botReady ?? false;

  const decidedText = useCallback((n: number) => t("ingest.rows.decided", { n }), [t]);
  const act = useReviewActions({ candidate, focus, announce, decidedText });
  const discard = useDiscardFlow(candidate, { onDone: () => void navigate({ to: "/ingest" }), count: plant.count });

  const bar = decisionBar(candidate, { can: { merge: canMerge, upload: canUpload }, botReady, editorOpen });
  const offer = helperOffer(candidate, botReady);
  const year = yearLine(candidate, plant.day);
  const questions = questionList(candidate.questions, candidate.target);
  const showEditor = editorOpen && (candidate.state === "needs_shape" || ((candidate.state === "ready" || candidate.state === "held") && canUpload));
  const canChangeMapping = canUpload && candidate.target !== null && (candidate.state === "ready" || candidate.state === "held");
  const read = readPanel(candidate, plant, canSeePrices, canChangeMapping);
  const showRead = candidate.block.headers.length > 0 && candidate.state !== "failed" && candidate.state !== "discarded";
  const showRows = !["needs_confirm", "needs_shape", "discarded"].includes(candidate.state) && candidate.counts.total > 0;

  const approved = approvedSummary(list.data ?? []);
  const after = act.after
    ? afterDecision({ kind: act.after.kind, approvedCount: approved.count, nextId: nextNeedsYou(list.data ?? [], candidate.id) })
    : null;

  // The bot gave up or hit its limit: the person maps the columns, so the editor opens.
  useEffect(() => {
    if (bot.phase === "gaveUp" || bot.phase === "capped") setEditorOpen(true);
  }, [bot.phase]);

  // The live region hears what changed, once: the import's state, an approval or a hold, and a long check at 25 percent steps.
  const lastState = useRef(candidate.state);
  useEffect(() => {
    if (lastState.current === candidate.state) return;
    lastState.current = candidate.state;
    announce([words(bar.chip.words), bar.sentence ? words(bar.sentence) : ""].filter(Boolean).join(". "));
  }, [candidate.state, announce, bar.chip.words, bar.sentence, words]);
  const lastAfter = useRef<number | null>(null);
  useEffect(() => {
    if (!act.after || lastAfter.current === act.after.nonce || !after) return;
    lastAfter.current = act.after.nonce;
    announce(words(after.words));
  }, [act.after, after, announce, words]);
  const lastProgress = useRef<number | null>(null);
  useEffect(() => {
    if (candidate.state !== "processing") {
      lastProgress.current = null;
      return;
    }
    const step = progressStep(lastProgress.current, dryRun.progress);
    lastProgress.current = dryRun.progress;
    if (step !== null) {
      announce(t("ingest.read.progress", { done: plant.count(classifiedRows(candidate.counts)), total: plant.count(candidate.counts.total) }));
    }
  }, [candidate.state, candidate.counts, dryRun.progress, announce, t, plant]);

  const openEditor = () => {
    setEditorOpen(true);
    focus.request([FOCUS.editorHeading]);
  };
  const closeEditor = () => {
    setEditorOpen(false);
    focus.request([FOCUS.changeMapping, FOCUS.bar]);
  };

  const press: BarPress = (id: BarActionId) => {
    switch (id) {
      case "approve":
      case "approveAsIs":
        void act.approve();
        break;
      case "hold":
        setHoldOpen(true);
        break;
      case "release":
        void act.release();
        break;
      case "useLayout":
        void act.confirmNear(true);
        break;
      case "rejectLayout":
        void act.confirmNear(false);
        break;
      case "mapForMe":
        bot.start();
        break;
      case "mapMyself":
        setEditorOpen((open) => !open);
        break;
      default:
        break;
    }
  };

  // "Answer 1 question to approve." goes to the first open thing: the year, a question, or the rows.
  const goToFirstOpen = () => {
    const first = questions.find((q) => !q.answered);
    if (first?.control.kind === "period") focus.focus(FOCUS.yearSelect);
    else if (bar.blocked?.to === "rows" && !first) focus.focus(FOCUS.rowsHeading);
    else focus.focus(FOCUS.firstQuestion);
  };

  const yearSelectRef = useCallback((el: HTMLSelectElement | null) => focus.ref(FOCUS.yearSelect)(el as HTMLElement | null), [focus]);
  const editorTargetRef = useCallback((el: HTMLSelectElement | null) => focus.ref(FOCUS.editorHeading)(el as HTMLElement | null), [focus]);
  const setBarRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrolledRef(el);
      focus.ref(FOCUS.bar)(el);
    },
    [scrolledRef, focus],
  );

  const stickyButtons = [...bar.buttons].reverse();
  // The editor has its own sticky bar (Save layout); two bars would sit on top of each other.
  const showSticky = scrolledOut && !showEditor && (bar.buttons.length > 0 || bar.blocked !== null);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4">
        <DecisionBarCard
          candidate={candidate}
          bar={bar}
          act={act}
          onPress={press}
          onDiscard={discard.ask}
          onIgnore={() => void act.ignoreSheet()}
          onRepick={() => void act.repick()}
          onGoToFirstOpen={goToFirstOpen}
          editorOpen={showEditor}
          editorId={EDITOR_ID}
          botWorking={bot.phase === "working"}
          year={year.show ? (
            <YearLine
              line={year}
              act={act}
              announce={announce}
              saved={candidate.periodConfirmed}
              selectRef={yearSelectRef}
              changeRef={focus.ref(FOCUS.yearChange)}
            />
          ) : null}
          after={after}
          barRef={setBarRef}
          afterRef={focus.ref(FOCUS.after)}
          notices={candidate.state === "needs_shape" ? <ShapeNotices offer={offer} bot={bot} /> : null}
        />
        {candidate.state === "processing" ? <DryRunBlock dryRun={dryRun} /> : null}
      </div>

      <div className="flex flex-col gap-4">
        <QuestionsPanel
          candidate={candidate}
          act={act}
          focusRef={focus.ref}
          onGoToRow={(n) => rowsRef.current?.goToRow(n)}
          onGoToYear={() => focus.focus(FOCUS.yearSelect)}
        />
        {showEditor ? (
          <MappingEditor
            id={EDITOR_ID}
            candidate={candidate}
            canSeePrices={canSeePrices}
            act={act}
            targetRef={editorTargetRef}
            onSaved={() => setEditorOpen(false)}
            onCancel={closeEditor}
          />
        ) : showRead ? (
          <ReadPanel model={read} onChange={openEditor} changeRef={focus.ref(FOCUS.changeMapping)} />
        ) : null}
        {showRows ? (
          <StagedRows
            key={candidate.id}
            candidate={candidate}
            canDecide={canUpload}
            act={act}
            focusRef={focus.ref}
            announce={announce}
            handle={rowsRef}
            onGoToQuestion={(q) => {
              if (!focus.focus(questionSentenceKey(q.code, q.subject))) focus.focus(FOCUS.firstQuestion);
            }}
          />
        ) : null}
      </div>

      {showSticky ? (
        <IngestBar
          className="lg:hidden"
          summary={bar.blocked ? <BlockedLink label={words(bar.blocked.words)} onPress={goToFirstOpen} /> : undefined}
        >
          <BarButtons
            quiet
            buttons={stickyButtons}
            act={act}
            onPress={press}
            artifactId={candidate.artifactId}
            editorOpen={showEditor}
            editorId={EDITOR_ID}
            botWorking={bot.phase === "working"}
          />
        </IngestBar>
      ) : null}

      <HoldSheet open={holdOpen} onOpenChange={setHoldOpen} act={act} />
      <DiscardDialog flow={discard} />
    </div>
  );
}

function BlockedLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <button type="button" className="inline-flex min-h-11 items-center text-left text-[14px] font-medium text-tone-amber-ink underline underline-offset-4" onClick={onPress}>
      {label}
    </button>
  );
}

/** Under the buttons of an import that needs a layout: what orrn does, and where the helper stands. */
function ShapeNotices({ offer, bot }: { offer: ReturnType<typeof helperOffer>; bot: ReturnType<typeof useBotPump> }): ReactNode {
  const { t, say } = useSay();
  return (
    <div className="flex flex-col gap-2">
      {/* With the helper off, "orrn suggests a layout" would sit right above "orrn cannot suggest one". */}
      {offer === "off" ? <Muted>{t("ingest.helper.off")}</Muted> : <Muted>{t("ingest.shape.explain")}</Muted>}
      {bot.phase === "working" ? <ProgressBar value={null} label={t("ingest.shape.working", { n: bot.attempt })} /> : null}
      {bot.phase === "otherTab" ? <InlineNotice>{t("ingest.merge.otherTab")}</InlineNotice> : null}
      {bot.phase === "gaveUp" ? <InlineNotice>{t("ingest.shape.gaveUp")}</InlineNotice> : null}
      {bot.phase === "capped" ? <InlineNotice>{t("ingest.shape.capped")}</InlineNotice> : null}
      {bot.phase === "error" ? <InlineNotice tone="danger">{say(ingestErrorWords(bot.error, "action").key)}</InlineNotice> : null}
    </div>
  );
}

/** The check of the rows after a decision or a new layout: a bar, and what to do when it stalls or fails. */
function DryRunBlock({ dryRun }: { dryRun: ReturnType<typeof useDryRunPump> }) {
  const { t, say } = useSay();
  if (dryRun.phase === "otherTab") return <InlineNotice>{t("ingest.merge.otherTab")}</InlineNotice>;
  if (dryRun.phase === "error") {
    return (
      <InlineNotice tone="danger">
        <div className="flex flex-wrap items-center gap-3">
          <span>{say(ingestErrorWords(dryRun.error, "action").key)}</span>
          <button type="button" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4" onClick={dryRun.retry}>
            {t("common.retry")}
          </button>
        </div>
      </InlineNotice>
    );
  }
  const label = dryRun.rowsMissing > 0 ? t("ingest.read.uploading") : t("ingest.state.processing");
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border bg-card p-4">
      <ProgressBar value={dryRun.rowsMissing > 0 ? null : dryRun.progress} label={label} />
      {dryRun.stalled ? <InlineNotice tone="danger">{t("ingest.read.stalled")}</InlineNotice> : null}
    </div>
  );
}
