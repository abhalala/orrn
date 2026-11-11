import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { cn } from "@orrn/ui/lib/utils";
import { useId, useState, type Ref } from "react";

import { fieldLabelKey, unitLabelKey, type ColumnEntry, type NearChangeRow, type ReadPanel as ReadPanelModel } from "../lib";
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
}: {
  model: ReadPanelModel;
  onChange: () => void;
  changeRef?: Ref<HTMLButtonElement>;
}) {
  const { t, words } = useSay();
  const [open, setOpen] = useState(model.openByDefault);
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
    { key: "samples", header: t("ingest.shape.samples"), cell: (e) => <SampleCell samples={e.samples} /> },
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
    { key: "samples", header: t("ingest.shape.samples"), cell: (r) => (r.samples ? <SampleCell samples={r.samples} /> : null) },
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
