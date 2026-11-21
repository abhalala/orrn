import { Button } from "@orrn/ui/components/button";
import { Dialog } from "@orrn/ui/components/dialog";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { Can } from "@/shared/components/can";
import { can, useMe } from "@/shared/lib/me";

import {
  blockVisionOf,
  hiddenPriceColumns,
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
 * (stacked under 768 px), marked rows first (digits not in the PDF's text, then rows rated low), blank cells marked, "Fix this cell" per row, then a
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
  const pricesId = useId();
  const rowsQ = useVisionRows(candidate.id, vision !== null);
  const image = usePageImage(candidate.artifactId, vision?.page ?? null);
  const [imageFailed, setImageFailed] = useState<string | null>(null);
  const act = useVisionCheckActions(candidate);
  const [fixing, setFixing] = useState<number | null>(null);
  const canSeePrices = can(me, "order.price");
  const editable = EDITABLE.has(candidate.state) && candidate.counts.written === 0;
  const typed = vision?.typed === true;
  const headers = candidate.block.headers;
  const masked = useMemo(() => hiddenPriceColumns(headers, candidate.target, canSeePrices), [headers, canSeePrices, candidate.target]);
  // Decision 6: a person who sees "Hidden" in any cell cannot tick; someone who can see prices checks this table.
  const pricesHidden = masked.some(Boolean);
  const [zoomOpen, setZoomOpen] = useState(false);
  // S3: after "Fix this cell" is saved or cancelled, focus goes back to that row's button (or the rows when it is gone).
  const fixButtons = useRef(new Map<number, HTMLButtonElement>());
  const rowsRegion = useRef<HTMLDivElement | null>(null);
  const [returnTo, setReturnTo] = useState<number | null>(null);
  useEffect(() => {
    if (fixing !== null || returnTo === null) return;
    const target = fixButtons.current.get(returnTo) ?? rowsRegion.current;
    target?.focus();
    setReturnTo(null);
  }, [fixing, returnTo]);
  const closeFix = useCallback((rowIndex: number) => {
    setReturnTo(rowIndex);
    setFixing(null);
  }, []);
  const rows = useMemo(() => (vision && rowsQ.data ? visionRows(rowsQ.data, vision, headers.length) : []), [vision, rowsQ.data, headers.length]);
  if (!vision) return null;

  const pageVars = { page: vision.page, count: vision.pageCount };
  const url = image.data?.url ?? null;
  const ticked = candidate.block.modelChecked;
  const approve = bar.vision?.approve ?? null;
  const lowCount = rows.filter((r) => r.low || r.unseen).length;

  return (
    <section aria-labelledby={headingId} data-testid="vision-check" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-card p-4 sm:p-5">
      <h2 id={headingId} className="m-0 text-[16px] font-semibold">
        {say("ingest.vision.rowsHeading")}
      </h2>
      <div className="grid min-w-0 grid-cols-1 gap-5 md:grid-cols-2">
        <figure className="m-0 flex min-w-0 flex-col gap-2">
          <figcaption className="text-[14px] font-medium">{say("ingest.vision.pageHeading", pageVars)}</figcaption>
          {url && imageFailed !== url ? (
            <>
              {/* A tap on the image opens it full size too; the button below is the way in for a keyboard. */}
              <img
                data-testid="vision-page-image"
                src={url}
                alt={say("ingest.vision.pageAlt", { ...pageVars, file: candidate.fileName })}
                className="h-auto w-full cursor-zoom-in rounded-card border border-border bg-white"
                onClick={() => setZoomOpen(true)}
                onError={() => setImageFailed(url)}
              />
              <OpenFullButton onOpen={() => setZoomOpen(true)} />
              <PageZoom
                open={zoomOpen}
                onOpenChange={setZoomOpen}
                title={say("ingest.vision.pageHeading", pageVars)}
                images={(fit) => <ZoomImage url={url} alt={say("ingest.vision.pageAlt", { ...pageVars, file: candidate.fileName })} fit={fit} />}
              />
            </>
          ) : image.isError && (vision.bands ?? 0) > 1 ? (
            // A page cut into bands may have no whole image (a dense text PDF resumed in another tab): its bands, in order.
            <div className="flex flex-col gap-1">
              {Array.from({ length: vision.bands! }, (_, i) => (
                <BandImage key={i} artifactId={candidate.artifactId} page={vision.page} band={i + 1} total={vision.bands!} alt={say("ingest.vision.partAlt", { ...pageVars, file: candidate.fileName, part: i + 1, parts: vision.bands! })} onOpen={() => setZoomOpen(true)} />
              ))}
              <OpenFullButton onOpen={() => setZoomOpen(true)} />
              <PageZoom
                open={zoomOpen}
                onOpenChange={setZoomOpen}
                title={say("ingest.vision.pageHeading", pageVars)}
                images={(fit) =>
                  Array.from({ length: vision.bands! }, (_, i) => (
                    <BandZoomImage key={i} artifactId={candidate.artifactId} page={vision.page} band={i + 1} fit={fit} alt={say("ingest.vision.partAlt", { ...pageVars, file: candidate.fileName, part: i + 1, parts: vision.bands! })} />
                  ))
                }
              />
            </div>
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
            <div ref={rowsRegion} className="max-w-full overflow-x-auto" tabIndex={0} role="region" aria-labelledby={headingId}>
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
                      fixRef={(el) => {
                        if (el) fixButtons.current.set(row.rowIndex, el);
                        else fixButtons.current.delete(row.rowIndex);
                      }}
                      onFix={() => (fixing === row.rowIndex ? closeFix(row.rowIndex) : setFixing(row.rowIndex))}
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
              onCancel={() => closeFix(fixing)}
              onSave={async (col, text) => {
                const row = fixing;
                const ok = await act.fixCell(row, col, text);
                if (ok) closeFix(row);
              }}
            />
          ) : null}
        </div>
      </div>

      {!typed ? (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          {/* The tick takes the same action as Approve (decision 5). */}
          <Can do="ingest.merge">
            <div className="flex min-h-11 items-center gap-3">
              <input
                ref={tickRef}
                id={tickId}
                type="checkbox"
                data-testid="vision-tick"
                checked={ticked}
                disabled={!editable}
                // Hidden prices: the box stays in the tab order (the bar's link goes here) but cannot be ticked.
                aria-disabled={pricesHidden || undefined}
                aria-describedby={pricesHidden ? `${pricesId} ${noteId}` : noteId}
                aria-busy={act.pending === "check" || undefined}
                className="size-6 shrink-0 accent-primary aria-disabled:opacity-50"
                onChange={(event) => {
                  if (act.busy || pricesHidden) return;
                  void act.check(event.currentTarget.checked);
                }}
              />
              <label htmlFor={tickId} className="text-[15px] font-medium leading-6">
                {say("ingest.vision.tick")}
              </label>
            </div>
          </Can>
          {pricesHidden ? (
            <p id={pricesId} data-testid="vision-prices-hidden" className="m-0 text-[14px] leading-6 font-medium text-tone-amber-ink">
              {say("ingest.vision.error.needsPrices")}
            </p>
          ) : null}
          <p id={noteId} className="m-0 text-[14px] leading-6 text-muted-foreground">
            {say("ingest.vision.tickNote")}
          </p>
          <ActionError error={act.error} />
          {approve ? (
            <Can do="ingest.merge">
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

/** One band image of a page read in bands, asked again like the page image; a failed band says so and offers retry. */
function BandImage({ artifactId, page, band, alt, onOpen }: { artifactId: string; page: number; band: number; total: number; alt: string; onOpen?: () => void }) {
  const { say } = useSay();
  const image = usePageImage(artifactId, page, band);
  const [failed, setFailed] = useState<string | null>(null);
  const url = image.data?.url ?? null;
  if (url && failed !== url) {
    return <img data-testid="vision-band-image" src={url} alt={alt} className="h-auto w-full cursor-zoom-in rounded-card border border-border bg-white" onClick={onOpen} onError={() => setFailed(url)} />;
  }
  if (image.isError || (url && failed === url)) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-card border border-border bg-surface-sunken p-3">
        <p className="m-0 text-[14px] text-tone-amber-ink">{say("ingest.vision.imageFailed")}</p>
        <Button variant="secondary" onClick={() => void image.refetch()}>
          {say("common.retry")}
        </Button>
      </div>
    );
  }
  return (
    <div aria-busy="true" className="h-40 w-full animate-pulse rounded-card bg-surface-sunken motion-reduce:animate-none">
      <span className="sr-only">{say("common.loading")}</span>
    </div>
  );
}

function RowLine({
  row,
  masked,
  canFix,
  fixing,
  onFix,
  fixRef,
}: {
  row: VisionRowView;
  masked: boolean[];
  canFix: boolean;
  fixing: boolean;
  onFix: () => void;
  fixRef: (el: HTMLButtonElement | null) => void;
}) {
  const { say } = useSay();
  return (
    <tr
      data-testid="vision-row"
      data-low={row.low || undefined}
      data-unseen={row.unseen || undefined}
      className={row.low || row.unseen ? "border-b border-border bg-tone-amber-tint/60" : "border-b border-border"}
    >
      <th scope="row" className="px-2 py-2 text-left align-top font-medium whitespace-nowrap">
        <span className="font-mono tabular-nums">{say("ingest.vision.rowName", { n: row.n })}</span>
        {row.low || row.unseen ? <span className="ml-2 inline-block rounded-sm bg-tone-amber-tint px-1.5 text-[12px] font-semibold text-tone-amber-ink">{say("ingest.vision.lowMark")}</span> : null}
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
        ) : cell.unseen ? (
          <td key={col} data-unseen className="px-2 py-2 align-top break-words">
            {/* The red ink sits on its own red tint (a designed pair), never on the amber row. */}
            <span className="block max-w-[26ch] rounded-sm bg-tone-red-tint px-1.5 py-1 text-tone-red-ink">
              <span className="font-semibold">{cell.text}</span>
              <span className="mt-1 block text-[12px] leading-snug">{say("ingest.vision.unseenMark")}</span>
            </span>
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
            <Button ref={fixRef} variant="ghost" size="sm" aria-expanded={fixing} aria-label={`${say("ingest.vision.fixCell")}, ${say("ingest.vision.rowName", { n: row.n })}`} onClick={onFix}>
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

/** "Open the page full size": the keyboard way into the zoom view (a tap on the image opens it too). */
function OpenFullButton({ onOpen }: { onOpen: () => void }) {
  const { say } = useSay();
  return (
    <Button variant="secondary" size="sm" aria-haspopup="dialog" data-testid="vision-open-full" className="self-start max-sm:w-full" onClick={onOpen}>
      <Maximize2 aria-hidden="true" className="size-4" strokeWidth={2} />
      {say("ingest.vision.openFull")}
    </Button>
  );
}

/**
 * The page image full size (decision 10): drawn at its own pixel width in a box that scrolls both ways, so the digits
 * can be read on a phone; pinch zoom works (the dialog allows it) and "Fit to the screen" shows the whole page. The
 * dialog traps focus, closes on Escape and gives focus back to what opened it. Each image keeps its text alternative.
 */
export function PageZoom({
  open,
  onOpenChange,
  title,
  images,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The images in order, drawn at full size or fitted to the screen. */
  images: (fit: boolean) => ReactNode;
}) {
  const { say } = useSay();
  const [fit, setFit] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={title} maxWidth={1600}>
      <ZoomBody hint={say("ingest.vision.zoomHint")}>{images(fit)}</ZoomBody>
      <div>
        <Button variant="secondary" size="sm" aria-pressed={fit} data-testid="vision-zoom-fit" onClick={() => setFit((f) => !f)}>
          {say(fit ? "ingest.vision.fullSize" : "ingest.vision.fitScreen")}
        </Button>
      </div>
    </Dialog>
  );
}

/** The zoom view's box: scrolls both ways, and touch pans and pinches inside it. */
export function ZoomBody({ hint, children }: { hint: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="m-0 text-[14px] leading-6 text-muted-foreground">{hint}</p>
      <div data-testid="vision-zoom" className="max-h-[70dvh] max-w-full overflow-auto overscroll-contain rounded-card border border-border bg-white" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
        {children}
      </div>
    </div>
  );
}

/** One image of the zoom view: its own pixel width, or the width of the screen. */
export function ZoomImage({ url, alt, fit }: { url: string; alt: string; fit: boolean }) {
  return <img data-testid="vision-zoom-image" src={url} alt={alt} className={fit ? "block h-auto w-full" : "block h-auto w-auto max-w-none"} />;
}

/** A band in the zoom view, asked like the band images (the same link, from the cache). */
function BandZoomImage({ artifactId, page, band, alt, fit }: { artifactId: string; page: number; band: number; alt: string; fit: boolean }) {
  const image = usePageImage(artifactId, page, band);
  const url = image.data?.url ?? null;
  return url ? <ZoomImage url={url} alt={alt} fit={fit} /> : null;
}
