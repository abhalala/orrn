import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useEffect, useId, useRef, useState } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import {
  capLine,
  emptyTypedTable,
  isVisualKind,
  KEPT_UNREAD,
  typedTableProblems,
  TYPED_MAX_COLUMNS,
  TYPED_MAX_ROWS,
  useVisionFileRead,
  useVisionPageActions,
  useVisionPages,
  visionFileActions,
  visionPageRow,
  visionProgressWords,
  visionShare,
  pageResultWords,
  type ArtifactDetail,
  type TypedTable,
  type VisionPageRow,
} from "../lib";
import { useSay } from "./list-kit";
import { ActionButton, Muted } from "./review-bits";
import { ActionError, chipTone, InlineNotice, ProgressBar } from "./shared";

/**
 * The file page of a PDF or photo (import portal release 2). A file kept before the read existed offers "Read this file":
 * the raw bytes come back by a signed read, the pages are rendered in this browser and read one by one. A file being read
 * lists its pages, each with its state and, when not read, why, with "Read again", "Type this page" and "Skip this page".
 * "Finish" once every page is read, typed or skipped. The cap line says which pages were read of a long file.
 */
export function VisionFilePanel({
  artifact,
  visionReady,
  announce,
}: {
  artifact: Pick<ArtifactDetail, "id" | "kind" | "readState" | "fileName">;
  visionReady: boolean;
  announce: (text: string) => void;
}) {
  const kept = String(artifact.readState) === KEPT_UNREAD;
  const reading = artifact.readState === "reading";
  if (!isVisualKind(artifact.kind)) return null;
  if (kept && !visionReady) return null;
  if (!kept && !reading) return null;
  return <Panel artifact={artifact} kept={kept} announce={announce} />;
}

function Panel({ artifact, kept, announce }: { artifact: Pick<ArtifactDetail, "id" | "kind" | "readState" | "fileName">; kept: boolean; announce: (text: string) => void }) {
  const { say, words } = useSay();
  const { data: me } = useMe();
  const canUpload = can(me, "ingest.upload");
  const headingId = useId();
  const pagesQ = useVisionPages(artifact.id, !kept);
  const read = useVisionFileRead(artifact.id, artifact.kind);
  const pages = pagesQ.data?.pages ?? [];
  const total = pagesQ.data?.planned ?? pages.length;
  const actions = useVisionPageActions(artifact.id, total);
  const [typing, setTyping] = useState<number | null>(null);
  const file = visionFileActions(pages, pagesQ.data?.settled ?? false);
  const cap = pagesQ.data ? capLine(pagesQ.data.pageCount) : null;
  const running = read.phase === "running";

  // Each step of a pass, and each page's answer, is said once in the screen's status region.
  const lastSaid = useRef("");
  useEffect(() => {
    if (!read.progress) return;
    const text = words(visionProgressWords(read.progress));
    if (text !== lastSaid.current) {
      lastSaid.current = text;
      announce(text);
    }
  }, [read.progress, words, announce]);
  useEffect(() => {
    if (actions.lastPage) announce(words(pageResultWords(actions.lastPage, total)));
  }, [actions.lastPage, total, words, announce]);

  return (
    <section aria-labelledby={headingId} data-testid="vision-pages" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 text-[16px] font-semibold">
          {say("ingest.vision.pagesTitle")}
        </h2>
        <Muted>{say("ingest.vision.readFileNote")}</Muted>
        {cap ? <p className="m-0 text-[14px] leading-6 text-tone-amber-ink">{words(cap)}</p> : null}
      </div>

      {running ? <ProgressBar value={read.progress ? visionShare(read.progress) : null} label={read.progress ? words(visionProgressWords(read.progress)) : say("ingest.vision.opening")} /> : null}
      {read.outcome?.kind === "cannotOpen" ? <InlineNotice tone="danger">{say("ingest.vision.cannotOpen")}</InlineNotice> : null}
      {read.outcome?.kind === "cannotReadNow" ? <InlineNotice>{say("ingest.vision.error.notRead")}</InlineNotice> : null}
      <ActionError error={read.error} />
      <ActionError error={actions.error} />

      {kept || file.carryOn ? (
        <Can do="ingest.upload">
          <div className="flex flex-wrap gap-3">
            <ActionButton busy={running} working={running} className="max-sm:w-full" onClick={() => void read.run({ needsBytes: kept || file.needsBytes, pages })}>
              {kept ? say("ingest.vision.readFile") : say("ingest.vision.carryOn")}
            </ActionButton>
          </div>
        </Can>
      ) : null}

      {pages.length > 0 ? (
        <ol className="m-0 flex list-none flex-col divide-y divide-border p-0" aria-label={say("ingest.vision.pagesTitle")}>
          {pages.map((view) => {
            const row = visionPageRow(view, canUpload);
            return (
              <li key={view.page} data-testid="vision-page" data-state={view.state} className="flex min-w-0 flex-col gap-2 py-3 first:pt-0 last:pb-0">
                <PageLine row={row} />
                {row.actions.length > 0 ? (
                  <Can do="ingest.upload">
                    <div className="flex flex-wrap gap-2">
                      {row.actions.map((action) => {
                        const label = say(action === "readAgain" ? "ingest.vision.readAgain" : action === "type" ? "ingest.vision.typePage" : "ingest.vision.skipPage");
                        const pendingName = action === "readAgain" ? `read:${view.page}` : action === "skip" ? `skip:${view.page}` : `type:${view.page}`;
                        return (
                          <ActionButton
                            key={action}
                            variant="secondary"
                            busy={actions.busy || running}
                            working={actions.pending === pendingName}
                            aria-label={say("ingest.vision.actionFor", { action: label, page: view.page })}
                            {...(action === "type" ? { "aria-expanded": typing === view.page } : {})}
                            onClick={() => {
                              if (action === "readAgain") void actions.readAgain(view.page);
                              else if (action === "skip") void actions.skip(view.page);
                              else setTyping((open) => (open === view.page ? null : view.page));
                            }}
                          >
                            {label}
                          </ActionButton>
                        );
                      })}
                    </div>
                  </Can>
                ) : null}
                {typing === view.page ? (
                  <TypePageForm
                    page={view.page}
                    busy={actions.busy}
                    onCancel={() => setTyping(null)}
                    onSave={async (table) => {
                      const ok = await actions.type(view.page, table);
                      if (ok) setTyping(null);
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {!kept && pagesQ.data ? (
        file.finish ? (
          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <Muted>{say("ingest.vision.finishNote")}</Muted>
            <Can do="ingest.upload">
              <div>
                <ActionButton busy={actions.busy || running} working={actions.pending === "finish"} className="max-sm:w-full" onClick={() => void actions.finish()}>
                  {say("ingest.vision.finish")}
                </ActionButton>
              </div>
            </Can>
          </div>
        ) : !file.carryOn ? (
          <Muted>{say("ingest.vision.notDone")}</Muted>
        ) : null
      ) : null}
    </section>
  );
}

function PageLine({ row }: { row: VisionPageRow }) {
  const { words } = useSay();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[15px] font-semibold">{words(row.name)}</span>
        <Chip tone={chipTone(row.tone)} truncate={false}>
          {words(row.state)}
        </Chip>
        {row.tables ? <span className="text-[14px] text-muted-foreground">{words(row.tables)}</span> : null}
        {row.bands ? <span className="text-[14px] text-muted-foreground">{words(row.bands)}</span> : null}
      </div>
      {row.reason ? <p className="m-0 text-[14px] leading-6 text-tone-amber-ink">{words(row.reason)}</p> : null}
    </div>
  );
}

/**
 * "Type this page": a small grid, the column names on top and one line per row, with "Add a row" and "Add a column".
 * Every cell is a labelled text box ("Row 2, column 3"), so the grid reads in order with a keyboard and a screen reader.
 */
function TypePageForm({ page, busy, onSave, onCancel }: { page: number; busy: boolean; onSave: (table: { title: string | null; headers: string[]; rows: string[][] }) => Promise<void>; onCancel: () => void }) {
  const { say } = useSay();
  const [table, setTable] = useState<TypedTable>(emptyTypedTable);
  const [problems, setProblems] = useState<string[]>([]);
  const headingId = useId();
  const firstRef = useRef<HTMLInputElement>(null);
  useEffect(() => firstRef.current?.focus(), []);
  const width = table.headers.length;

  const setHeader = (col: number, value: string) => setTable((t) => ({ ...t, headers: t.headers.map((h, i) => (i === col ? value : h)) }));
  const setCell = (row: number, col: number, value: string) =>
    setTable((t) => ({ ...t, rows: t.rows.map((r, i) => (i === row ? Array.from({ length: width }, (_, c) => (c === col ? value : (r[c] ?? ""))) : r)) }));
  const addRow = () => setTable((t) => ({ ...t, rows: [...t.rows, Array.from({ length: t.headers.length }, () => "")] }));
  const addColumn = () => setTable((t) => ({ ...t, headers: [...t.headers, ""], rows: t.rows.map((r) => [...r, ""]) }));
  const removeRow = (row: number) => setTable((t) => ({ ...t, rows: t.rows.length > 1 ? t.rows.filter((_, i) => i !== row) : t.rows }));

  const save = async () => {
    const check = typedTableProblems(table);
    setProblems(check.problems);
    if (!check.ok) return;
    await onSave({ title: table.title.trim() === "" ? null : table.title.trim(), headers: check.headers, rows: check.rows });
  };

  return (
    <div role="group" aria-labelledby={headingId} data-testid="vision-type" className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface-sunken/60 p-3 sm:p-4">
      <h3 id={headingId} className="m-0 text-[15px] font-semibold">
        {say("ingest.vision.type.title", { page })}
      </h3>
      <Muted>{say("ingest.vision.type.intro")}</Muted>
      <Field label={say("ingest.vision.type.tableTitle")} className="max-w-[420px]">
        <TextInput ref={firstRef} value={table.title} maxLength={200} onChange={(e) => setTable((t) => ({ ...t, title: e.currentTarget.value }))} />
      </Field>
      <div className="max-w-full overflow-x-auto">
        <table className="border-separate border-spacing-1">
          <thead>
            <tr>
              {table.headers.map((header, col) => (
                <th key={col} scope="col" className="p-0 align-bottom">
                  <TextInput
                    value={header}
                    maxLength={200}
                    aria-label={say("ingest.vision.type.header", { n: col + 1 })}
                    className="min-w-[8rem] font-semibold"
                    onChange={(e) => setHeader(col, e.currentTarget.value)}
                  />
                </th>
              ))}
              <td className="p-0" />
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r}>
                {table.headers.map((_, col) => (
                  <td key={col} className="p-0">
                    <TextInput
                      value={row[col] ?? ""}
                      maxLength={200}
                      aria-label={say("ingest.vision.type.cell", { row: r + 1, col: col + 1 })}
                      className="min-w-[8rem]"
                      onChange={(e) => setCell(r, col, e.currentTarget.value)}
                    />
                  </td>
                ))}
                <td className="p-0">
                  {table.rows.length > 1 ? (
                    <Button variant="ghost" size="sm" onClick={() => removeRow(r)}>
                      {say("ingest.vision.type.removeRow", { row: r + 1 })}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={table.rows.length >= TYPED_MAX_ROWS} onClick={addRow}>
          {say("ingest.vision.type.addRow")}
        </Button>
        <Button variant="secondary" disabled={table.headers.length >= TYPED_MAX_COLUMNS} onClick={addColumn}>
          {say("ingest.vision.type.addColumn")}
        </Button>
      </div>
      {problems.length > 0 ? (
        <ul role="alert" className="m-0 flex list-none flex-col gap-1 p-0 text-[14px] text-destructive">
          {problems.map((key) => (
            <li key={key}>{say(key)}</li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <ActionButton busy={busy} className="max-sm:w-full" onClick={() => void save()}>
          {say("ingest.vision.type.save")}
        </ActionButton>
        <Button variant="ghost" className="max-sm:w-full" onClick={onCancel}>
          {say("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
