import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { cn } from "@orrn/ui/lib/utils";
import { useEffect, useId, useRef, useState } from "react";

import { INGEST_TARGETS, TARGET_KEY, twoRowsFrom, useRowsWords, type HeaderAskView, type HeaderReply } from "../lib";
import { ForeignText, useSay } from "./list-kit";
import { ScrollCue } from "./shared";

/** Cells shown for each row: all of the first few columns on a wide screen, fewer on a phone. */
const WIDE_COLUMNS = 6;
const NARROW_COLUMNS = 3;

/** A, B, ... Z, AA: the column letters a person sees in Excel. */
export function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * "Which row has the column names?" (owner decision, 2026-11-11): the first rows of one table with their row numbers, the
 * reader's guess selected, one or two header rows, and a way out for a table the person does not want. For a table that
 * follows another one it offers, first, to join the two. Everything it shows comes from `headerAskView`; this file draws
 * it and reports the answer.
 */
export function HeaderStep({ view, fileName, onReply }: { view: HeaderAskView; fileName: string; onReply: (reply: HeaderReply) => void }) {
  const { t } = useT();
  const { say } = useSay();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const groupId = useId();
  const headingId = useId();
  // When orrn offers to join this table to the one above, that is the answer it expects: no data row is selected, so the person
  // is not one tap from importing a data row as the column names (design check M5). Picking a row is a different answer.
  const offered = view.offers.length > 0;
  const [row, setRow] = useState<number | null>(offered ? null : view.preselected.headerRow);
  const [rows, setRows] = useState<1 | 2>(view.preselected.headerRows);
  const [busy, setBusy] = useState(false);

  // A new table (or a new question) takes focus once, on its heading: the heading is read, the rows follow by Tab.
  useEffect(() => {
    headingRef.current?.focus();
  }, [view.position]);
  useEffect(() => {
    if (view.hintError) setBusy(false);
  }, [view.hintError, view.attempt]);

  const selected = row === null ? undefined : view.lines.find((l) => l.row === row);
  const two = row === null ? null : twoRowsFrom(view.lines, row);
  const canTwo = two !== null && two[1] !== null;
  const useWords = selected ? useRowsWords(selected, canTwo ? rows : 1, two) : null;
  const reply = (r: HeaderReply) => {
    if (busy) return;
    setBusy(true);
    onReply(r);
  };
  const target = view.resembles && (INGEST_TARGETS as readonly string[]).includes(view.resembles.name) ? say(TARGET_KEY(view.resembles.name as never)) : null;
  const shownWide = Math.min(view.columns, WIDE_COLUMNS);
  const cols = Array.from({ length: shownWide }, (_, i) => i);

  return (
    <section aria-labelledby={headingId} data-testid="header-step" className="flex min-w-0 flex-col gap-4 rounded-card border border-border bg-surface-sunken/50 p-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h3 id={headingId} ref={headingRef} tabIndex={-1} className="m-0 text-[16px] leading-6 font-semibold outline-none">
          {t("ingest.header.title")}
        </h3>
        <p className="m-0 text-[13px] leading-5 text-muted-foreground">
          {view.total > 1 ? `${say("ingest.header.count", { n: view.position, total: view.total })}. ` : ""}
          {view.sheetName ? (
            <>
              <ForeignText>{view.sheetName}</ForeignText>
              {", "}
              {say("ingest.header.aboutNoSheet", { count: view.rowCount })}
            </>
          ) : (
            say("ingest.header.aboutNoSheet", { count: view.rowCount })
          )}
        </p>
        {view.resembles ? (
          <p className="m-0 text-[15px] leading-6">
            {say("ingest.header.looksLike", { name: target ?? view.resembles.name, n: view.resembles.n })}
          </p>
        ) : null}
        <span className="sr-only">{fileName}</span>
      </div>

      {view.offers.length > 0 ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          {view.offers.map((offer, i) => (
            <Button key={offer} variant={i === 0 && !selected ? "primary" : "secondary"} className="max-sm:w-full" aria-disabled={busy || undefined} onClick={() => reply({ kind: offer })}>
              {t(offer === "continues" ? "ingest.header.continues" : "ingest.header.same")}
            </Button>
          ))}
        </div>
      ) : null}

      {view.offers.length > 0 ? <p className="m-0 text-[13px] text-muted-foreground">{t("ingest.header.orPick")}</p> : null}

      <div role="radiogroup" aria-labelledby={headingId} id={groupId} className="min-w-0">
        <ScrollCue>
          <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px] leading-5 max-sm:min-w-max sm:table-fixed">
            <caption className="sr-only">{t("ingest.header.tableCaption")}</caption>
            <thead>
              <tr>
                <th scope="col" className="w-[72px] py-1 pr-2 text-left font-medium text-muted-foreground sm:w-[88px]">
                  <span className="sr-only">{t("ingest.header.rowLabel", { n: "" })}</span>
                </th>
                {cols.map((c) => (
                  <th key={c} scope="col" aria-hidden="true" className={cn("py-1 pr-2 text-left font-medium text-muted-foreground", c >= NARROW_COLUMNS && "max-sm:hidden")}>
                    {columnLetter(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.lines.map((line) => {
                const on = line.row === row;
                const cells = line.cells.filter((c) => c.trim() !== "");
                const name = say("ingest.header.rowName", { n: line.n, cells: cells.length > 0 ? cells.slice(0, 4).join(", ") : t("ingest.header.empty") });
                return (
                  <RowLines key={line.row} gap={line.gapBefore} columns={shownWide}>
                    <tr className={cn("border-t border-border align-top", on && "bg-card")} onClick={() => setRow(line.row)}>
                      <td className={cn("py-1.5 pr-2", on && "border-l-[3px] border-l-foreground pl-1.5")}>
                        <label className="inline-flex min-h-6 cursor-pointer items-center gap-2 font-medium pointer-coarse:min-h-11 pointer-coarse:min-w-11">
                          <input
                            type="radio"
                            name={groupId}
                            value={line.row}
                            checked={on}
                            aria-label={name}
                            className="size-4 accent-[var(--color-foreground)]"
                            onChange={() => setRow(line.row)}
                          />
                          <span className="font-mono tabular-nums">{line.n}</span>
                        </label>
                      </td>
                      {cols.map((c) => (
                        <td key={c} title={line.cells[c] ?? ""} className={cn("py-1.5 pr-2 max-sm:whitespace-nowrap sm:truncate", on && "font-semibold", c >= NARROW_COLUMNS && "max-sm:hidden")}>
                          <ForeignText>{line.cells[c] ?? ""}</ForeignText>
                        </td>
                      ))}
                    </tr>
                  </RowLines>
                );
              })}
            </tbody>
          </table>
          </div>
        </ScrollCue>
        {/* Columns the phone leaves out (from D on) are said too, not only the ones the wide screen leaves out. */}
        {view.columns > NARROW_COLUMNS ? <p data-testid="more-columns-narrow" className="m-0 mt-1 text-[12px] text-muted-foreground sm:hidden">{say("ingest.header.moreColumns", { count: view.columns - NARROW_COLUMNS })}</p> : null}
        {view.columns > shownWide ? <p data-testid="more-columns" className="m-0 mt-1 text-[12px] text-muted-foreground max-sm:hidden">{say("ingest.header.moreColumns", { count: view.columns - shownWide })}</p> : null}
      </div>

      {canTwo ? (
        <div className="flex flex-col gap-1.5">
          <SegmentedControl<"1" | "2">
            label={t("ingest.header.namesTake")}
            value={rows === 2 ? "2" : "1"}
            options={[
              { value: "1", label: t("ingest.header.oneRow") },
              { value: "2", label: t("ingest.header.twoRows") },
            ]}
            onChange={(v) => setRows(v === "2" ? 2 : 1)}
            className="max-w-sm"
          />
          {rows === 2 && selected ? <p className="m-0 text-[13px] text-muted-foreground">{say("ingest.header.twoHint", { n: selected.n })}</p> : null}
        </div>
      ) : null}

      {view.hintError ? (
        <p role="alert" className="m-0 text-[14px] font-medium text-tone-amber-ink">
          {t("ingest.header.pickAnother")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {selected && useWords ? (
          <Button
            className="max-sm:w-full"
            variant="primary"
            aria-disabled={busy || undefined}
            onClick={() => reply({ kind: "pick", headerRow: selected.row, headerRows: canTwo ? rows : 1 })}
          >
            {say(useWords.key, useWords.vars)}
          </Button>
        ) : null}
        <Button variant="ghost" className="max-sm:w-full" aria-disabled={busy || undefined} onClick={() => reply({ kind: "skip" })}>
          {t("ingest.header.skip")}
        </Button>
      </div>
    </section>
  );
}

/** A row of the table, preceded by a drawn gap when row numbers were left out above it. */
function RowLines({ gap, columns, children }: { gap: boolean; columns: number; children: React.ReactNode }) {
  const { t } = useT();
  return (
    <>
      {gap ? (
        <tr data-testid="header-gap" className="border-t border-dashed border-border">
          <td colSpan={columns + 1} className="py-1 text-center text-[12px] text-muted-foreground">
            {t("ingest.header.gap")}
          </td>
        </tr>
      ) : null}
      {children}
    </>
  );
}
