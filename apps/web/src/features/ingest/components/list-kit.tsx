import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { Check } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, type ReactNode } from "react";

import {
  actionFocusKey,
  cardLabel,
  focusAfterListAction,
  listFormat,
  MERGE_BAR_FOCUS,
  sayWords,
  useFocusReturn,
  useIngestActions,
  usePlantUnits,
  useRunAction,
  type ListRow,
  type Say,
  type Words,
} from "../lib";
import { ReasonText, chipTone, translateKey } from "./shared";

/**
 * Small pieces shared by the upload, list, file and merge screens. No business logic: a view model from `../lib`
 * says what to show, these draw it. Numbers go through the plant's formatter (1,400 and 2,00,000).
 */

/** The screen's way to say a key or a `Words`: numbers are grouped the plant's way, and the list formats come along. */
export function useSay() {
  const { t } = useT();
  const plant = usePlantUnits();
  return useMemo(() => {
    const say: Say = (key, vars) => {
      if (!vars) return translateKey(t, key);
      const out: Record<string, string | number> = {};
      for (const [name, value] of Object.entries(vars)) out[name] = typeof value === "number" ? plant.count(value) : value;
      return translateKey(t, key, out);
    };
    const words = (w: Words) => sayWords(say, w);
    return { say, words, plant, fmt: listFormat(plant) };
  }, [t, plant]);
}

/** Tab title for the screen (WCAG 2.4.2). Nothing is set while the title is not known yet. */
export function useDocTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/** The one polite status region of a screen: always mounted, empty at first, filled by `useAnnouncer`. */
export function StatusRegion({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}

/**
 * A file or sheet name: one line, 13 px sans, cut in the middle (the end and the extension stay), the whole name in
 * `title` and in the text a screen reader reads. On a Hindi screen it is marked `lang="en"` (WCAG 3.1.2).
 */
export function FileName({ name, className }: { name: string; className?: string }) {
  const { locale } = useT();
  const cut = name.length > 18 ? name.length - 8 : name.length;
  return (
    <span lang={locale === "en" ? undefined : "en"} title={name} className={cn("flex min-w-0 max-w-full text-[13px] leading-5", className)}>
      <span className="truncate">{name.slice(0, cut)}</span>
      {cut < name.length ? <span className="shrink-0">{name.slice(cut)}</span> : null}
    </span>
  );
}

/** Text that came from a file (a sheet name): marked `lang="en"` on a Hindi screen (WCAG 3.1.2). */
export function ForeignText({ children, className }: { children: ReactNode; className?: string }) {
  const { locale } = useT();
  return (
    <span lang={locale === "en" ? undefined : "en"} className={className}>
      {children}
    </span>
  );
}

/** Wraps each number of a sentence in mono ("Added 700 of 701"), the words around it stay sans. */
export function MonoText({ text }: { text: string }) {
  const parts = text.split(/(\d[\d,.]*\d|\d)/);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <span key={index} className="font-mono tabular-nums">
            {part}
          </span>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The writes a list row makes (Approve, Hold) and where focus goes after them
// ---------------------------------------------------------------------------------------------

export type RowControls = {
  /** A write is running: every write button is `aria-disabled`, a second press does nothing. */
  busy: boolean;
  /** `approve:<id>` or `hold:<id>` while it runs. */
  pending: string | null;
  run: (kind: "approve" | "hold", row: ListRow) => void;
  ref: (key: string) => (el: HTMLElement | null) => void;
};

/**
 * Approve and Hold from a list row. One write at a time (`useRunAction`), the page says what happened through the
 * screen's status region, and focus goes to the next row's action, or to the merge bar when no row is left.
 */
export function useListActions(input: {
  /** The ids of the rows on screen, in order. */
  visibleIds: readonly string[];
  /** Imports approved right now, for "N approved so far". */
  approvedCount: number;
  announce: (text: string) => void;
}) {
  const actions = useIngestActions();
  const runner = useRunAction();
  const focus = useFocusReturn();
  const { say } = useSay();
  const { visibleIds, approvedCount, announce } = input;

  const run = useCallback(
    (kind: "approve" | "hold", row: ListRow) => {
      const c = row.candidate;
      void runner
        .run(
          `${kind}:${c.id}`,
          () => (kind === "approve" ? actions.approve(c.id, c.serverSeq) : actions.hold(c.id, c.serverSeq)),
          { candidateId: c.id },
        )
        .then((ok) => {
          if (!ok) return;
          announce(kind === "approve" ? say("ingest.action.approvedSoFar", { count: approvedCount + 1 }) : say("ingest.action.heldDone"));
          focus.request([focusAfterListAction(visibleIds, c.id), MERGE_BAR_FOCUS]);
        });
    },
    [actions, announce, approvedCount, focus, runner, say, visibleIds],
  );

  const controls: RowControls = { busy: runner.busy, pending: runner.pending, run, ref: focus.ref };
  return { controls, error: runner.error, runner, focus, actions };
}

// ---------------------------------------------------------------------------------------------
// The rows of an import list
// ---------------------------------------------------------------------------------------------

const BUTTON_WIDTH = "w-full lg:w-auto aria-disabled:cursor-default aria-disabled:opacity-60";

function Num({ value, tone }: { value: number; tone?: "amber" }) {
  const { plant } = useSay();
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        value === 0 ? "text-muted-foreground" : tone === "amber" ? "font-semibold text-tone-amber-ink" : "text-foreground",
      )}
    >
      {plant.count(value)}
    </span>
  );
}

function StatusChip({ row }: { row: ListRow }) {
  const { words } = useSay();
  const text = words(row.chip.words);
  // Approved shows a tick so it differs from Ready at a glance, and the word stays on it (work order N2).
  return (
    <Chip tone={chipTone(row.chip.tone)} truncate={false} dot={row.candidate.state !== "approved"} title={text}>
      {row.candidate.state === "approved" ? (
        <span className="inline-flex items-center gap-1">
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          {text}
        </span>
      ) : (
        text
      )}
    </Chip>
  );
}

function TitleCell({ row, stacked, extra }: { row: ListRow; stacked: boolean; extra?: ReactNode }) {
  const { say, words } = useSay();
  const title = row.title;
  const name = title.kind === "sheet" ? title.name : say(title.key);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[15px] font-semibold text-foreground break-words">
          {title.kind === "sheet" ? <ForeignText>{name}</ForeignText> : name}
        </span>
        {title.kind === "target" && title.sheetName ? (
          <ForeignText className="text-[13px] font-normal text-muted-foreground break-words">{title.sheetName}</ForeignText>
        ) : null}
        {stacked ? <StatusChip row={row} /> : null}
      </span>
      {stacked && row.fit ? <span className="text-[13px] font-normal text-muted-foreground">{words(row.fit)}</span> : null}
      {row.reasonCode || row.reasonDetail ? <ReasonText code={row.reasonCode} detail={row.reasonDetail} /> : null}
      {extra}
      {/* The row link names the import, so two rows of the same kind do not read alike (WCAG 2.4.4). */}
      <span className="sr-only">, {row.candidate.fileName}</span>
    </div>
  );
}

function ActionCell({ row, controls }: { row: ListRow; controls?: RowControls }) {
  const { say } = useSay();
  const action = row.action;
  if (!action) return null;
  const c = row.candidate;
  const label = say(action.labelKey);
  const name = cardLabel(say, label, c);
  if (action.mode === "link") {
    return (
      <Button asChild variant={action.variant} className={BUTTON_WIDTH}>
        <UiLink to={`/ingest/review/${c.id}`} aria-label={name}>
          {label}
        </UiLink>
      </Button>
    );
  }
  if (!controls) return null;
  const kind = action.kind === "hold" ? "hold" : "approve";
  return (
    <Button
      ref={controls.ref(actionFocusKey(c.id))}
      variant={action.variant}
      aria-label={name}
      aria-disabled={controls.busy || undefined}
      aria-busy={controls.pending === `${kind}:${c.id}` || undefined}
      className={BUTTON_WIDTH}
      onClick={() => controls.run(kind, row)}
    >
      {label}
    </Button>
  );
}

/** Fixed widths of the list's columns, so every file group lines up under the one header (work order 3.2). */
const WIDTHS = { fit: "w-[148px]", create: "w-[72px]", update: "w-[84px]", questions: "w-[96px]", cannot: "w-[84px]", status: "w-[156px]", action: "w-[148px]" } as const;

/**
 * The columns of an import list (work order 3.2): what it is, layout, four counts, status, and the one action.
 * Below 1024 px the rows stack: the chip and the layout move up under the title. `extra` is a second line under the
 * title (the file screen lists the columns there). A count that is not known yet shows nothing, and on a phone the
 * pair is left out.
 */
function useImportColumns(controls: RowControls | undefined, extra: ((row: ListRow) => ReactNode) | undefined): ResponsiveListColumn<ListRow>[] {
  const { t } = useT();
  const { words } = useSay();
  const wide = useMediaQuery(breakpoints.desktop);
  const count = (key: keyof NonNullable<ListRow["numbers"]>, tone?: "amber") => (row: ListRow) =>
    row.numbers ? <Num value={row.numbers[key]} tone={tone} /> : null;
  return [
    { key: "what", header: t("ingest.imports.colWhat"), cell: (row) => <TitleCell row={row} stacked={!wide} extra={extra?.(row)} /> },
    {
      key: "fit",
      header: t("ingest.imports.colFit"),
      hideOnPhone: true,
      width: WIDTHS.fit,
      cell: (row) => (row.fit ? <span className="text-[13px] text-muted-foreground">{words(row.fit)}</span> : null),
    },
    { key: "create", header: t("ingest.list.colNew"), align: "end", width: WIDTHS.create, hideWhenEmpty: true, cell: count("create") },
    { key: "update", header: t("ingest.list.colUpdates"), align: "end", width: WIDTHS.update, hideWhenEmpty: true, cell: count("update") },
    { key: "questions", header: t("ingest.list.colQuestions"), align: "end", width: WIDTHS.questions, hideWhenEmpty: true, cell: count("questions", "amber") },
    { key: "cannot", header: t("ingest.list.colCannot"), align: "end", width: WIDTHS.cannot, hideWhenEmpty: true, cell: count("cannot") },
    { key: "status", header: t("ingest.imports.colStatus"), hideOnPhone: true, width: WIDTHS.status, cell: (row) => <StatusChip row={row} /> },
    { key: "action", header: t("ingest.imports.colAction"), headerHidden: true, width: WIDTHS.action, cell: (row) => <ActionCell row={row} controls={controls} /> },
  ];
}

/** The rows of one file as one list (the file screen). */
export function ImportRows({
  rows,
  label,
  controls,
  extra,
  empty,
}: {
  rows: ListRow[];
  label: string;
  controls?: RowControls;
  extra?: (row: ListRow) => ReactNode;
  empty?: ReactNode;
}) {
  const columns = useImportColumns(controls, extra);
  return (
    <ResponsiveList<ListRow>
      label={label}
      rows={rows}
      columns={columns}
      rowKey={(row) => row.id}
      rowHref={(row) => `/ingest/review/${row.id}`}
      empty={empty ?? null}
    />
  );
}

/**
 * Every file group in one card under one header row (work order 3.2). Each group is a full-width heading row, then
 * its imports. The columns have fixed widths, so New, Updates, Questions, Cannot import, Status and the action keep
 * their place from group to group.
 */
export function ImportGroups<G extends { artifactId: string; rows: ListRow[] }>({
  groups,
  label,
  controls,
  heading,
}: {
  groups: readonly G[];
  label: string;
  controls?: RowControls;
  heading: (group: G) => ReactNode;
}) {
  const columns = useImportColumns(controls, undefined);
  return (
    <ResponsiveList<ListRow>
      label={label}
      sections={groups.map((group) => ({ key: group.artifactId, heading: heading(group), rows: group.rows }))}
      columns={columns}
      rowKey={(row) => row.id}
      rowHref={(row) => `/ingest/review/${row.id}`}
      empty={null}
    />
  );
}
