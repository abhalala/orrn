import { Button, IconButton } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@orrn/ui/components/dropdown-menu";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";

import {
  cardFields,
  decisionButtonName,
  decisionGroupName,
  groupRowNotes,
  refusalText,
  refusalTone,
  ROWS_UI_PAGE,
  rowFocusKey,
  rowsTable,
  rowView,
  visibleRowFilters,
  useRowsBrowser,
  usePlantUnits,
  type CandidateDetail,
  type DecisionOption,
  type RowColumn,
  type RowGroupNotes,
  type RowView,
  type ValueCell,
} from "../lib";
import { ActionButton, EvidencePanel, Foreign, useSay } from "./review-bits";
import { ActionError, chipTone, QueryPanel, ScrollCue } from "./shared";
import { FOCUS, type ReviewActions } from "./use-review-actions";

type Act = Pick<ReviewActions, "decide" | "busy" | "pending" | "failed">;
type FocusRef = (key: string) => (el: HTMLElement | null) => void;

/** The question a row waits on, as the server marks it (`q:<code>` on the row). */
export type RowQuestionRef = { code: string; subject: string };

export type RowsHandle = { goToRow: (n: number) => void };

/**
 * Rows as they will appear in orrn (work order 3.3, M12, S1). Filters with counts, "Needs a decision" first and selected
 * when it has rows. From 1024 px always a table, with one column per mapped field and its plant unit in the header (a wide
 * layout scrolls sideways under a pinned Row column, and the decision buttons sit next to the Row so they stay in view);
 * below, stacked cards. Only a row that needs a decision has buttons, and they save on a press, never on a select change (WCAG 3.2.2).
 *
 * Mount it under a component keyed by the candidate id only, so a decision never resets the filter or the page.
 */
export function StagedRows({
  candidate,
  canDecide,
  act,
  focusRef,
  announce,
  handle,
  onGoToQuestion,
}: {
  candidate: CandidateDetail;
  canDecide: boolean;
  act: Act;
  focusRef: FocusRef;
  announce: (text: string) => void;
  handle?: Ref<RowsHandle>;
  /** A row that waits on a question links to it. */
  onGoToQuestion?: (question: RowQuestionRef) => void;
}) {
  const { t, words } = useSay();
  const plant = usePlantUnits();
  const wide = useMediaQuery(breakpoints.desktop);
  const browser = useRowsBrowser(candidate.id, candidate.counts);
  const items = browser.rows.items;
  const allViews = useMemo(() => items.map((row) => rowView(candidate, row, plant)), [items, candidate, plant]);
  // What a group of waiting rows repeats is said once above the table; each row keeps its status and its action.
  const group = useMemo(() => groupRowNotes(allViews), [allViews]);
  const views = group.views;
  const table = useMemo(() => rowsTable(candidate, views, plant), [candidate, views, plant]);
  const ids = useMemo(() => items.map((row) => row.id), [items]);
  const [wantRow, setWantRow] = useState<number | null>(null);

  // The live region hears the view change once: a new filter or page, not every row that loads.
  const seen = useRef<string | null>(null);
  useEffect(() => {
    const key = `${browser.filter}:${browser.page}`;
    if (seen.current !== null && seen.current !== key) announce(words(browser.showing));
    seen.current = key;
  }, [browser.filter, browser.page, browser.showing, announce, words]);

  useImperativeHandle(handle, () => ({
    goToRow: (n: number) => {
      browser.setFilter("all");
      for (let i = 0; i < Math.floor((n - 1) / ROWS_UI_PAGE); i += 1) browser.nextPage();
      setWantRow(n);
    },
  }), [browser]);
  useEffect(() => {
    if (wantRow === null || !views.some((v) => v.n === wantRow)) return;
    const el = document.getElementById(`row-${wantRow}`);
    if (el) {
      el.focus();
      el.scrollIntoView?.({ block: "center" });
      setWantRow(null);
    }
  }, [wantRow, views]);

  const decide = (row: RowView, option: DecisionOption) => void act.decide({ id: row.id, n: row.n }, option, ids);
  const showChoice = canDecide && (table.decisionColumn || views.some((v) => v.menu.length > 0));
  const asTable = wide;
  const filters = visibleRowFilters(browser.options);

  return (
    <EvidencePanel title={t("ingest.rows.title")} headingRef={focusRef(FOCUS.rowsHeading)}>
      {filters.length > 0 ? (
        <div role="group" aria-label={t("common.filter")} className="flex flex-wrap gap-2">
          {filters.map((option) => {
            const selected = option.id === browser.filter;
            const label = option.id === "needsDecision"
              ? t("ingest.rows.needsDecision", { count: plant.count(option.count) })
              : `${t(option.key as never)} ${plant.count(option.count)}`;
            return (
              <Button
                key={option.id}
                ref={selected ? focusRef(FOCUS.rowsFilter) : undefined}
                size="sm"
                variant="secondary"
                aria-pressed={selected}
                className={cn(selected && "border-foreground bg-surface-sunken")}
                onClick={() => browser.setFilter(option.id)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      ) : null}
      {group.lines.length > 0 || group.waitsOnQuestion ? <GroupNotes group={group} onGoToQuestion={onGoToQuestion} firstWait={allViews.find((v) => v.waitsOn)?.waitsOn ?? null} /> : null}
      <QueryPanel query={browser.rows}>
        {views.length === 0 ? (
          <div className="rounded-card border border-border">
            <EmptyState title={t("ingest.rows.none")} />
          </div>
        ) : asTable ? (
          <ScrollCue><RowsTable views={views} columns={table.columns} showChoice={showChoice} decisionColumn={table.decisionColumn} canDecide={canDecide} act={act} focusRef={focusRef} onDecide={decide} onGoToQuestion={onGoToQuestion} /></ScrollCue>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0 lg:grid lg:grid-cols-2">
            {views.map((row) => (
              <RowCard key={row.id} view={row} canDecide={canDecide} act={act} focusRef={focusRef} onDecide={decide} onGoToQuestion={onGoToQuestion} />
            ))}
          </ul>
        )}
      </QueryPanel>
      <ActionError error={act.failed("rows")} />
      {browser.pager ? (
        <nav aria-label={t("ui.pages")} className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" aria-disabled={browser.page === 0 || undefined} onClick={() => browser.page > 0 && browser.previousPage()}>
            {t("common.previousPage")}
          </Button>
          <span className="text-[14px] text-muted-foreground">{words(browser.pageWords)}</span>
          <Button variant="secondary" aria-disabled={!browser.rows.hasNext || undefined} onClick={() => browser.rows.hasNext && browser.nextPage()}>
            {t("common.nextPage")}
          </Button>
        </nav>
      ) : null}
    </EvidencePanel>
  );
}

type RowProps = {
  canDecide: boolean;
  act: Act;
  focusRef: FocusRef;
  onDecide: (row: RowView, option: DecisionOption) => void;
  onGoToQuestion?: (question: RowQuestionRef) => void;
};

/** One value of a row in the table: mono for numbers and codes, "Hidden" for a rate the person may not see. */
function CellValue({ cell, showUnit }: { cell: ValueCell | undefined; showUnit: boolean }) {
  const { t } = useSay();
  if (!cell) return null;
  if (cell.hidden) return <span className="text-[14px] text-muted-foreground">{t("ingest.rate.hidden")}</span>;
  const text = cell.textKey ? t(cell.textKey as never) : cell.text;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-[14px] break-words">
        <span className={cn(cell.mono && "font-mono tabular-nums")}>{text}</span>
        {showUnit && cell.unit ? <span className="ml-1 text-[0.85em] text-muted-foreground">{cell.unit}</span> : null}
      </span>
      {cell.fileSaid ? (
        <span className="text-[12px] leading-4 text-muted-foreground">
          {t("ingest.row.entered")} <span className="font-mono tabular-nums">{cell.fileSaid}</span>
        </span>
      ) : null}
    </span>
  );
}

const TONE_CLASS = { amber: "text-tone-amber-ink", red: "text-tone-red-ink", note: "text-muted-foreground" } as const;

/**
 * Why a row is refused or waits, in the order the server wrote it; its raw English sits in a `lang="en"` span. A refusal
 * is red ink. A value that is asked about, never refused, is amber ink.
 */
function ReasonLines({ view, className }: { view: RowView; className?: string }) {
  const { say } = useSay();
  if (view.reasons.length === 0) return null;
  return (
    <ul className={cn("m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] leading-5 break-words", className)}>
      {view.reasons.map((line, index) => (
        <li key={index} className={TONE_CLASS[refusalTone(line)]}>
          {line.kind === "raw" ? <span lang="en">{line.text}</span> : refusalText(say, line)}
        </li>
      ))}
    </ul>
  );
}

/** The sentences a group of waiting rows shares, said once above the table. */
function GroupNotes({ group, onGoToQuestion, firstWait }: { group: RowGroupNotes; onGoToQuestion?: (question: RowQuestionRef) => void; firstWait: RowQuestionRef | null }) {
  const { t, say } = useSay();
  return (
    <ul data-testid="row-group-notes" className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] leading-6">
      {group.lines.map((line) => (
        <li key={`${line.key}|${line.count ?? ""}`} className={TONE_CLASS[refusalTone(line)]}>
          {refusalText(say, line)}
        </li>
      ))}
      {group.waitsOnQuestion ? (
        <li>
          {onGoToQuestion && firstWait ? (
            <a
              href="#review-first-open"
              className="inline-flex min-h-6 pointer-coarse:min-h-11 items-center underline underline-offset-4"
              onClick={(event) => {
                event.preventDefault();
                onGoToQuestion(firstWait);
              }}
            >
              {t("ingest.rows.waitsOnQuestion")}
            </a>
          ) : (
            <span className="text-muted-foreground">{t("ingest.rows.waitsOnQuestion")}</span>
          )}
        </li>
      ) : null}
    </ul>
  );
}

/** "Answer the question above, or skip the row." as a link to the question the row waits on. */
function WaitsOnLine({ view, onGoToQuestion }: { view: RowView; onGoToQuestion?: (question: RowQuestionRef) => void }) {
  const { t } = useSay();
  const waits = view.waitsOn;
  if (!waits) return null;
  if (!onGoToQuestion) return <span className="text-[13px] text-muted-foreground">{t("ingest.rows.waitsOnQuestion")}</span>;
  return (
    <a
      href="#review-first-open"
      className="inline-flex min-h-6 pointer-coarse:min-h-11 items-center self-start text-[13px] text-foreground underline underline-offset-4"
      onClick={(event) => {
        event.preventDefault();
        onGoToQuestion(waits);
      }}
    >
      {t("ingest.rows.waitsOnQuestion")}
    </a>
  );
}

/** The file's own cells of a row with nothing mapped, labelled by the file's header (or "Column 3"). */
function RawCells({ view }: { view: RowView }) {
  const { t } = useSay();
  if (view.raw.length === 0) return null;
  return (
    <dl className="m-0 flex flex-col gap-0.5 text-[13px]">
      {view.raw.map((cell) => (
        <div key={cell.n} className="flex gap-2">
          <dt className="text-muted-foreground">{cell.label ? <Foreign>{cell.label}</Foreign> : t("ingest.rows.column", { n: cell.n })}</dt>
          <dd className="m-0 font-mono break-words">{cell.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiffLines({ view }: { view: RowView }) {
  const { t } = useSay();
  if (view.diffs.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-input bg-surface-sunken p-2 text-[13px] break-words">
      {view.diffs.map((diff) => (
        <div key={diff.fieldKey}>
          <p className="m-0 font-semibold">{t(diff.fieldKey as never)}</p>
          <p className="m-0">{t("ingest.decide.keepLive")}: <span className={diff.liveKey ? undefined : "font-mono"}>{diff.liveKey ? t(diff.liveKey as never) : diff.live}</span></p>
          <p className="m-0">{t("ingest.decide.keepFile")}: <span className={diff.fileKey ? undefined : "font-mono"}>{diff.fileKey ? t(diff.fileKey as never) : diff.file}</span></p>
        </div>
      ))}
    </div>
  );
}

/** The inline buttons of a row that needs a decision. All secondary; each name ends with the row ("Add as new, row 3"). */
function DecisionButtons({ view, act, focusRef, onDecide }: Pick<RowProps, "act" | "focusRef" | "onDecide"> & { view: RowView }) {
  const { say } = useSay();
  return (
    <div role="group" aria-label={decisionGroupName(say, view.n)} className="flex flex-col gap-2 md:flex-row md:flex-wrap">
      {view.decisions.map((option, index) => (
        <ActionButton
          key={`${option.decision}:${option.matchId ?? ""}`}
          ref={index === 0 ? focusRef(rowFocusKey(view.id)) : undefined}
          variant="secondary"
          size="sm"
          className="max-md:w-full"
          aria-label={decisionButtonName(say, option, view.n)}
          busy={act.busy}
          working={act.pending === `row:${view.id}`}
          onClick={() => onDecide(view, option)}
        >
          {say(option.key, option.vars)}
        </ActionButton>
      ))}
    </div>
  );
}

/** What a row that needs nothing still allows: Skip, in a menu. A press, Enter or Space acts once. */
function RowMenu({ view, act, focusRef, onDecide }: Pick<RowProps, "act" | "focusRef" | "onDecide"> & { view: RowView }) {
  const { t, say } = useSay();
  if (view.menu.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          ref={focusRef(rowFocusKey(view.id))}
          variant="ghost"
          label={t("ingest.action.more", { name: t("ingest.q.aboutRow", { n: view.n }) })}
          icon={<MoreHorizontal strokeWidth={2} />}
          aria-disabled={act.busy || undefined}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {view.menu.map((option) => (
          <DropdownMenuItem
            key={option.decision}
            className="min-h-11 text-[15px]"
            onSelect={() => {
              if (!act.busy) onDecide(view, option);
            }}
          >
            {say(option.key, option.vars)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What the person chose on a decided row, in the words of the button they pressed. */
function Chosen({ view }: { view: RowView }) {
  const { words } = useSay();
  if (!view.chosen) return null;
  return <p className="m-0 text-[13px] text-muted-foreground">{words(view.chosen)}</p>;
}

function StatusChip({ view }: { view: RowView }) {
  const { say } = useSay();
  if (!view.chip) return null;
  return <Chip tone={chipTone(view.chip.tone)} truncate={false}>{say(view.chip.key)}</Chip>;
}

export function RowsTable({
  views,
  columns,
  showChoice,
  decisionColumn,
  ...rest
}: RowProps & { views: RowView[]; columns: RowColumn[]; showChoice: boolean; decisionColumn: boolean }) {
  const { t } = useSay();
  const rowColumn: ResponsiveListColumn<RowView> = {
    key: "row",
    header: t("imports.preview.row"),
    sticky: true,
    cell: (v) => (
      <>
        {v.needsDecision ? <span aria-hidden="true" data-testid="needs-decision-mark" className="absolute inset-y-0 left-0 w-[3px] bg-tone-amber-ink" /> : null}
        <span id={`row-${v.n}`} tabIndex={-1} className="font-mono tabular-nums outline-none">{v.n}</span>
      </>
    ),
  };
  const statusColumn: ResponsiveListColumn<RowView> = {
    key: "status",
    header: t("ingest.row.state"),
    cell: (v) => (
      <span className="flex min-w-0 flex-col items-start gap-1">
        <span className="flex items-center gap-1">
          <StatusChip view={v} />
          {/* Skip for a row that needs nothing sits beside its chip, so it takes no column of its own. */}
          {!decisionColumn && showChoice && !v.needsDecision ? <RowMenu view={v} act={rest.act} focusRef={rest.focusRef} onDecide={rest.onDecide} /> : null}
        </span>
        {v.needsDecision ? null : <ReasonLines view={v} />}
        <RawCells view={v} />
        <Chosen view={v} />
      </span>
    ),
  };
  const choiceColumn: ResponsiveListColumn<RowView> = {
    key: "choice",
    header: t("ingest.rows.choice"),
    headerHidden: !decisionColumn,
    cell: (v) => {
      if (!v.needsDecision) return <RowMenu view={v} {...rest} />;
      return (
        <span className="flex min-w-0 flex-col items-start gap-2">
          <ReasonLines view={v} />
          <WaitsOnLine view={v} onGoToQuestion={rest.onGoToQuestion} />
          <DiffLines view={v} />
          {rest.canDecide ? <DecisionButtons view={v} {...rest} /> : null}
        </span>
      );
    },
  };
  const fieldColumns = columns.map((column): ResponsiveListColumn<RowView> => ({
    key: `field:${column.field}`,
    header: column.unit ? `${t(column.labelKey as never)}, ${column.unit}` : t(column.labelKey as never),
    align: column.align === "end" ? "end" : undefined,
    wrapHeader: true,
    cell: (v) => <CellValue cell={v.cells.find((c) => c.field === column.field)} showUnit={false} />,
  }));
  // Row, then what it is and what to do about it, then the values: a layout with many fields scrolls sideways under the
  // pinned Row column, and the buttons of a row that needs a decision never sit behind that scroll.
  const list: ResponsiveListColumn<RowView>[] = [rowColumn, statusColumn, ...(decisionColumn && showChoice ? [choiceColumn] : []), ...fieldColumns];
  return <ResponsiveList label={t("ingest.rows.title")} rows={views} columns={list} rowKey={(v) => v.id} empty={null} />;
}

/** Phone and tablet: one card per row. At most five fields, the rest behind "Show all fields". */
function RowCard({ view, canDecide, act, focusRef, onDecide, onGoToQuestion }: RowProps & { view: RowView }) {
  const { t } = useSay();
  const [expanded, setExpanded] = useState(false);
  const fields = cardFields(view.cells, expanded);
  return (
    <li
      data-testid="row-card"
      data-needs-decision={view.needsDecision || undefined}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-3",
        view.needsDecision && "border-l-[3px] border-l-tone-amber-ink",
      )}
    >
      <div className="flex min-h-9 items-center justify-between gap-2">
        <span id={`row-${view.n}`} tabIndex={-1} className="text-[14px] font-semibold outline-none">{t("ingest.q.aboutRow", { n: view.n })}</span>
        <span className="flex items-center gap-2">
          <StatusChip view={view} />
          {canDecide && !view.needsDecision && view.menu.length > 0 ? <RowMenu view={view} act={act} focusRef={focusRef} onDecide={onDecide} /> : null}
        </span>
      </div>
      {fields.shown.length > 0 ? (
        <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2">
          {fields.shown.map((cell) => (
            <div key={cell.field} className="flex min-w-0 flex-col">
              <dt className="text-[12px] leading-4 break-words text-muted-foreground">{t(cell.labelKey as never)}</dt>
              <dd className="m-0 min-w-0 text-[14px]"><CellValue cell={cell} showUnit /></dd>
            </div>
          ))}
        </dl>
      ) : null}
      {fields.hidden > 0 ? (
        <Button variant="ghost" size="sm" className="self-start" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)}>
          {t("ingest.rows.showAll")}
        </Button>
      ) : null}
      <RawCells view={view} />
      <ReasonLines view={view} />
      {view.waitsOn ? <WaitsOnLine view={view} onGoToQuestion={onGoToQuestion} /> : null}
      <DiffLines view={view} />
      <Chosen view={view} />
      {canDecide && view.needsDecision ? <DecisionButtons view={view} act={act} focusRef={focusRef} onDecide={onDecide} /> : null}
    </li>
  );
}
