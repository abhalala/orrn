import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useId, useMemo, useState } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import {
  blockVisionOf,
  isRateColumn,
  usePageImage,
  useVisionCheckActions,
  useVisionRows,
  visionRows,
  type BarActionId,
  type CandidateDetail,
  type DecisionBar,
  type VisionRowView,
} from "../lib";
import { ActionButton, FieldSelect, Muted, useSay } from "./review-bits";
import { ActionError, ScrollCue } from "./shared";

/** States in which the server lets a cell be fixed or the tick change (it checks again). */
const EDITABLE = new Set(["ready", "held", "needs_confirm", "needs_shape"]);

/**
 * The check of a table read from a page (import portal release 2): the page image beside the rows the model read
 * (stacked under 768 px), rows it was not sure of first and marked, blank cells marked, "Fix this cell" per row, then a
 * real checkbox "I checked these rows against the page" and Approve after it. Keyboard order: the rows, the tick, Approve.
 * A table typed by hand from a page shows the page and its rows and needs no tick.
 */
export function VisionCheckPanel({
  candidate,
  bar,
  approveBusy,
  approveWorking,
  onApprove,
  tickRef,
}: {
  candidate: CandidateDetail;
  bar: DecisionBar;
  approveBusy: boolean;
  approveWorking: boolean;
  onApprove: (id: BarActionId) => void;
  tickRef: (el: HTMLElement | null) => void;
}) {
  const { say } = useSay();
  const { data: me } = useMe();
  const vision = blockVisionOf(candidate.block);
  const headingId = useId();
  const noteId = useId();
  const tickId = useId();
  const rowsQ = useVisionRows(candidate.id, vision !== null);
  const image = usePageImage(candidate.artifactId, vision?.page ?? null);
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  const act = useVisionCheckActions(candidate);
  const [fixing, setFixing] = useState<number | null>(null);
  const canSeePrices = can(me, "order.price");
  const editable = EDITABLE.has(candidate.state) && candidate.counts.written === 0;
  const typed = vision?.typed === true;
  const headers = candidate.block.headers;
  const masked = useMemo(() => headers.map((h) => !canSeePrices && isRateColumn(h, null, candidate.target)), [headers, canSeePrices, candidate.target]);
  const rows = useMemo(() => (vision && rowsQ.data ? visionRows(rowsQ.data, vision, headers.length) : []), [vision, rowsQ.data, headers.length]);
  if (!vision) return null;

  const pageVars = { page: vision.page, count: vision.pageCount };
  const url = image.data?.url ?? null;
  const ticked = candidate.block.modelChecked;
  const approve = bar.vision?.approve ?? null;
  const lowCount = rows.filter((r) => r.low).length;

  return (
    <section aria-labelledby={headingId} data-testid="vision-check" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id={headingId} className="m-0 text-[16px] font-semibold">
        {say("ingest.vision.rowsHeading")}
      </h2>
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <figure className="m-0 flex min-w-0 flex-col gap-2">
          <figcaption className="text-[14px] font-medium">{say("ingest.vision.pageHeading", pageVars)}</figcaption>
          {url && imageFailed !== url ? (
            <img
              data-testid="vision-page-image"
              src={url}
              alt={say("ingest.vision.pageAlt", { ...pageVars, file: candidate.fileName })}
              className="h-auto w-full rounded-card border border-border bg-white"
              onError={() => setImageFailed(url)}
            />
          ) : image.isError || (url && imageFailed === url) ? (
            <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface-sunken p-4">
              <p className="m-0 text-[14px] text-tone-amber-ink">{say("ingest.vision.imageFailed")}</p>
              <Button variant="secondary" onClick={() => void image.refetch()}>
                {say("common.retry")}
              </Button>
            </div>
          ) : (
            <div aria-busy="true" className="aspect-[3/4] w-full animate-pulse rounded-card bg-surface-sunken motion-reduce:animate-none">
              <span className="sr-only">{say("common.loading")}</span>
            </div>
          )}
        </figure>

        <div className="flex min-w-0 flex-col gap-3">
          {typed ? <Muted>{say("ingest.vision.typed", { page: vision.page })}</Muted> : lowCount > 0 ? <Muted>{say("ingest.vision.lowFirst")}</Muted> : null}
          {rowsQ.isError ? <ActionError error={rowsQ.error} kind="load" /> : null}
          <ScrollCue>
            <div className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-labelledby={headingId}>
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-2 py-2 font-semibold whitespace-nowrap">
                      <span className="sr-only">{say("ingest.vision.rowHeader")}</span>
                    </th>
                    {headers.map((h, col) => (
                      <th key={col} scope="col" className="px-2 py-2 font-semibold break-words">
                        {h.trim() === "" ? say("ingest.rows.column", { n: col + 1 }) : h}
                      </th>
                    ))}
                    {!typed && editable ? <td className="px-2 py-2" /> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <RowLine
                      key={row.id}
                      row={row}
                      masked={masked}
                      canFix={!typed && editable}
                      fixing={fixing === row.rowIndex}
                      onFix={() => setFixing((open) => (open === row.rowIndex ? null : row.rowIndex))}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </ScrollCue>
          {fixing !== null ? (
            <FixCellForm
              key={fixing}
              row={rows.find((r) => r.rowIndex === fixing) ?? null}
              headers={headers}
              masked={masked}
              busy={act.busy}
              onCancel={() => setFixing(null)}
              onSave={async (col, text) => {
                const ok = await act.fixCell(fixing, col, text);
                if (ok) setFixing(null);
              }}
            />
          ) : null}
        </div>
      </div>

      {!typed ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <Can do={["ingest.upload", "ingest.merge"]}>
            <div className="flex min-h-11 items-center gap-3">
              <input
                ref={tickRef}
                id={tickId}
                type="checkbox"
                data-testid="vision-tick"
                checked={ticked}
                disabled={!editable}
                aria-describedby={noteId}
                aria-busy={act.pending === "check" || undefined}
                className="size-5 shrink-0 accent-primary"
                onChange={(event) => {
                  if (act.busy) return;
                  void act.check(event.currentTarget.checked);
                }}
              />
              <label htmlFor={tickId} className="text-[15px] font-medium leading-6">
                {say("ingest.vision.tick")}
              </label>
            </div>
          </Can>
          <p id={noteId} className="m-0 text-[14px] leading-6 text-muted-foreground">
            {say("ingest.vision.tickNote")}
          </p>
          <ActionError error={act.error} />
          {approve ? (
            <Can do={["ingest.upload", "ingest.merge"]}>
              <div>
                <ActionButton
                  data-testid="vision-approve"
                  variant={approve.variant === "primary" ? "primary" : "secondary"}
                  busy={approveBusy || !ticked}
                  working={approveWorking}
                  aria-describedby={!ticked ? noteId : undefined}
                  className="max-sm:w-full"
                  onClick={() => onApprove(approve.id)}
                >
                  {say(approve.words.key, approve.words.vars)}
                </ActionButton>
              </div>
            </Can>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function RowLine({ row, masked, canFix, fixing, onFix }: { row: VisionRowView; masked: boolean[]; canFix: boolean; fixing: boolean; onFix: () => void }) {
  const { say } = useSay();
  return (
    <tr data-testid="vision-row" data-low={row.low || undefined} className={row.low ? "border-b border-border bg-tone-amber-tint/60" : "border-b border-border"}>
      <th scope="row" className="px-2 py-2 text-left align-top font-medium whitespace-nowrap">
        <span className="font-mono tabular-nums">{say("ingest.vision.rowName", { n: row.n })}</span>
        {row.low ? <span className="ml-2 inline-block rounded-sm bg-tone-amber-tint px-1.5 text-[12px] font-semibold text-tone-amber-ink">{say("ingest.vision.lowMark")}</span> : null}
      </th>
      {row.cells.map((cell, col) =>
        masked[col] ? (
          <td key={col} className="px-2 py-2 align-top text-muted-foreground">
            {say("ingest.rate.hidden")}
          </td>
        ) : cell.blank ? (
          <td key={col} className="px-2 py-2 align-top">
            <span className="rounded-sm border border-dashed border-control px-1.5 text-[12px] text-muted-foreground">{say("ingest.vision.blank")}</span>
          </td>
        ) : (
          <td key={col} className="px-2 py-2 align-top break-words">
            {cell.text}
          </td>
        ),
      )}
      {canFix ? (
        <td className="px-2 py-1 align-top">
          <Can do="ingest.upload">
            <Button variant="ghost" size="sm" aria-expanded={fixing} aria-label={`${say("ingest.vision.fixCell")}, ${say("ingest.vision.rowName", { n: row.n })}`} onClick={onFix}>
              {say("ingest.vision.fixCell")}
            </Button>
          </Can>
        </td>
      ) : null}
    </tr>
  );
}

/** One cell of a row put right: the column, then the text as it is on the page. */
function FixCellForm({
  row,
  headers,
  masked,
  busy,
  onSave,
  onCancel,
}: {
  row: VisionRowView | null;
  headers: readonly string[];
  masked: boolean[];
  busy: boolean;
  onSave: (col: number, text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { say } = useSay();
  const columns = headers.map((h, col) => ({ col, name: h.trim() === "" ? say("ingest.rows.column", { n: col + 1 }) : h })).filter((c) => !masked[c.col]);
  const firstBlank = row?.cells.findIndex((c, col) => c.blank && !masked[col]) ?? -1;
  const [col, setCol] = useState<number>(firstBlank >= 0 ? firstBlank : (columns[0]?.col ?? 0));
  const [text, setText] = useState<string>(row?.cells[col]?.text ?? "");
  if (!row) return null;
  const columnName = columns.find((c) => c.col === col)?.name ?? "";
  return (
    <div role="group" aria-label={say("ingest.vision.fixCellName", { row: row.n, column: columnName })} data-testid="vision-fix" className="flex flex-col gap-3 rounded-card border border-border bg-surface-sunken/60 p-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Field label={say("ingest.vision.fixColumn")} className="sm:w-56">
          <FieldSelect
            value={String(col)}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              setCol(next);
              setText(row.cells[next]?.text ?? "");
            }}
          >
            {columns.map((c) => (
              <option key={c.col} value={String(c.col)}>
                {c.name}
              </option>
            ))}
          </FieldSelect>
        </Field>
        <Field label={say("ingest.vision.fixLabel", { row: row.n, column: columnName })} className="min-w-0 flex-1">
          <TextInput autoFocus value={text} maxLength={200} onChange={(event) => setText(event.currentTarget.value)} />
        </Field>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <ActionButton busy={busy} className="max-sm:w-full" onClick={() => void onSave(col, text)}>
          {say("ingest.vision.fixSave")}
        </ActionButton>
        <Button variant="ghost" className="max-sm:w-full" onClick={onCancel}>
          {say("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
