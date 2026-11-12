import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { cn } from "@orrn/ui/lib/utils";
import { useId, useState, type Ref } from "react";

import { fieldLabelKey, SECTIONS_OPEN_MAX, unitLabelKey, type ColumnEntry, type NearChangeRow, type ReadFacts, type ReadPanel as ReadPanelModel } from "../lib";
import { ColumnHeaderCell, EvidencePanel, Foreign, Muted, PreviewCell, SampleCell, useSay } from "./review-bits";

/**
 * "How orrn read this file" (work order 3.3, M10, M11): the column table of the mapping editor, read only. One line
 * for a known layout; open for a layout orrn or a person made, a near fit and an import that needs a layout. A near
 * fit adds the "What changed" table. "Change mapping" turns the panel into the editor.
 */
export function ReadPanel({
  model,
  onChange,
  changeRef,
  roomy: roomyProp,
  reput,
}: {
  model: ReadPanelModel;
  onChange: () => void;
  changeRef?: Ref<HTMLButtonElement>;
  /** There is room for the open table (a tablet or wider). By default this follows the screen; a test sets it. */
  roomy?: boolean;
  /** "Start a new table here" on a title the table went on under: offered while no row is written. */
  reput?: { onStartNewTable: (row: number) => void; onContinues?: () => void; busy: boolean } | null;
}) {
  const { t, words } = useSay();
  // On a phone the panel starts as its one-line summary whatever the state (10 column cards push everything else away).
  const wideScreen = useMediaQuery(breakpoints.tablet);
  const roomy = roomyProp ?? wideScreen;
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (model.openByDefault && roomy);
  const setOpen = (update: (v: boolean) => boolean) => setChosen(update(open));
  const bodyId = useId();
  return (
    <EvidencePanel
      title={t("ingest.read.title")}
      actions={
        model.canChange ? (
          <Button ref={changeRef} variant="secondary" onClick={onChange}>
            {t("ingest.read.change")}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Muted>{words(model.summary)}</Muted>
        <Button variant="ghost" size="sm" aria-expanded={open} aria-controls={bodyId} onClick={() => setOpen((v) => !v)}>
          {open ? t("ingest.read.hide") : t("ingest.read.show")}
        </Button>
      </div>
      {model.facts ? <ReadFactsView facts={model.facts} reput={reput ?? null} /> : null}
      <div id={bodyId} hidden={!open} className="flex flex-col gap-5">
        {open ? (
          <>
            <ReadTable entries={model.entries} />
            {model.changes && model.changes.length > 0 ? <NearChanges rows={model.changes} /> : null}
          </>
        ) : null}
      </div>
    </EvidencePanel>
  );
}

function ReadTable({ entries }: { entries: ColumnEntry[] }) {
  const { t } = useSay();
  const columns: ResponsiveListColumn<ColumnEntry>[] = [
    {
      key: "column",
      header: t("ingest.shape.column"),
      cell: (e) => <ColumnHeaderCell header={e.header} headerBlank={e.headerBlank} n={e.n} kindKey={e.kind.key} muted={e.muted} />,
    },
    {
      key: "samples",
      header: t("ingest.shape.samples"),
      hideWhenEmpty: true,
      // A column with no values leaves its label out (a phone card has nothing to say under it).
      cell: (e) => (e.samples.masked || e.samples.values.length > 0 ? <SampleCell samples={e.samples} /> : null),
    },
    {
      key: "into",
      header: t("ingest.shape.field"),
      cell: (e) => (
        <span className="flex min-w-0 flex-col">
          <span className={cn("text-[14px] break-words", e.muted && "text-muted-foreground")}>
            {e.field ? t(fieldLabelKey(e.field) as never) : t("ingest.shape.notUsed")}
          </span>
          {e.unit?.kind === "number" ? (
            <span className="text-[13px] text-muted-foreground">
              {e.unit.value ? t(unitLabelKey(e.unit.value) as never) : t("ingest.shape.unitAsk")}
            </span>
          ) : e.unit?.kind === "date" ? (
            <span className="text-[13px] text-muted-foreground">{e.unit.choices.find((c) => c.value === e.unit?.value)?.text}</span>
          ) : null}
        </span>
      ),
    },
    { key: "preview", header: t("ingest.shape.preview"), cell: (e) => <PreviewCell preview={e.preview} /> },
  ];
  return <ResponsiveList label={t("ingest.read.title")} rows={entries} columns={columns} rowKey={(e) => String(e.col)} empty={null} />;
}

/** "What changed" for a near fit: the saved column, the column in this file, and its samples. Renamed, New and Missing are marked. */
function NearChanges({ rows }: { rows: NearChangeRow[] }) {
  const { t, words } = useSay();
  const columns: ResponsiveListColumn<NearChangeRow>[] = [
    {
      key: "saved",
      header: t("ingest.near.saved"),
      cell: (r) => (
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <Chip tone="amber" truncate={false}>{words(r.chip)}</Chip>
          {r.saved ? <Foreign className="text-[14px] font-semibold break-words">{r.saved}</Foreign> : null}
        </span>
      ),
    },
    {
      key: "now",
      header: t("ingest.near.now"),
      cell: (r) => (r.now ? <Foreign className="text-[14px] break-words">{r.now}</Foreign> : <span className="text-[14px] text-muted-foreground">{t("ingest.near.notInFile")}</span>),
    },
    {
      key: "samples",
      header: t("ingest.shape.samples"),
      hideWhenEmpty: true,
      cell: (r) => (r.samples && (r.samples.masked || r.samples.values.length > 0) ? <SampleCell samples={r.samples} /> : null),
    },
  ];
  return (
    <section aria-labelledby="near-changes-title" className="flex flex-col gap-3">
      <h3 id="near-changes-title" className="m-0 font-display text-[17px] font-bold tracking-[-0.02em]">
        {t("ingest.near.changedTitle")}
      </h3>
      <ResponsiveList
        label={t("ingest.near.changedTitle")}
        rows={rows}
        columns={columns}
        rowKey={(r) => `${r.kind}:${r.saved ?? ""}:${r.now ?? ""}`}
        empty={null}
      />
    </section>
  );
}

/**
 * What the reader left out of this table and the titles it went on under (round 7). Nothing it skipped is hidden: each line
 * has its row number and text, "and N more" when the server kept only the first 200. More than 12 titles are a count and a
 * list that opens. Each title can start a new table while no row is written.
 */
export function ReadFactsView({ facts, reput }: { facts: ReadFacts; reput: { onStartNewTable: (row: number) => void; onContinues?: () => void; busy: boolean } | null }) {
  const { say } = useSay();
  const many = facts.sections.length + facts.moreSections > SECTIONS_OPEN_MAX;
  const sectionList = (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {facts.sections.map((s) => (
        <li key={`${s.row}:${s.text}`} className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
          <span className="min-w-0 break-words">{say("ingest.read.section", { text: s.text, n: s.n })}</span>
          {reput ? (
            <Button variant="secondary" aria-disabled={reput.busy || undefined} className="max-sm:w-full" onClick={() => !reput.busy && reput.onStartNewTable(s.row)}>
              {say("ingest.read.newTableHere")}
              <span className="sr-only">, {say("ingest.read.section", { text: s.text, n: s.n })}</span>
            </Button>
          ) : null}
        </li>
      ))}
      {facts.moreSections > 0 ? <li>{say("ingest.read.more", { count: facts.moreSections })}</li> : null}
    </ul>
  );
  return (
    <div data-testid="read-facts" className="flex min-w-0 flex-col gap-2 text-[14px] leading-6">
      {facts.continuesAbove && reput?.onContinues ? (
        <div>
          <Button variant="secondary" aria-disabled={reput.busy || undefined} className="max-sm:w-full" onClick={() => !reput.busy && reput.onContinues?.()}>
            {say("ingest.header.continues")}
          </Button>
        </div>
      ) : null}
      {facts.gaps > 0 ? <p className="m-0">{say("ingest.read.gaps", { count: facts.gaps })}</p> : null}
      {facts.warnings.length > 0 ? (
        <details open={facts.warnings.length <= 3}>
          <summary className="min-h-6 cursor-pointer pointer-coarse:min-h-11">{say("ingest.read.leftOut", { count: facts.warnings.length + facts.moreWarnings })}</summary>
          <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0 text-muted-foreground">
            {facts.warnings.map((w) => (
              <li key={`${w.n}:${w.code}`} className="break-words">
                {say(`ingest.read.${w.code}`, { n: w.n, text: w.text })}
              </li>
            ))}
            {facts.moreWarnings > 0 ? <li>{say("ingest.read.more", { count: facts.moreWarnings })}</li> : null}
          </ul>
        </details>
      ) : null}
      {facts.sections.length > 0 ? (
        many ? (
          <details>
            <summary className="min-h-6 cursor-pointer pointer-coarse:min-h-11">{say("ingest.read.sections", { count: facts.sections.length + facts.moreSections })}</summary>
            <div className="mt-2">{sectionList}</div>
          </details>
        ) : (
          sectionList
        )
      ) : null}
    </div>
  );
}
