import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { NativeSelect } from "@orrn/ui/components/native-select";
import { useState } from "react";

import { Can } from "@/shared/components/can";

import {
  decisionOptions,
  diffEntries,
  refusalLines,
  refusalText,
  rowStateCounts,
  rowStateKey,
  rowTone,
  useIngestActions,
  useRows,
  valueCells,
  type CandidateDetail,
  type RowState,
  type StagedRowView,
} from "../lib";
import { ActionError, chipTone, Panel, QueryPanel, translateKey } from "./shared";

export function StagedRows({ candidate, onChanged }: { candidate: CandidateDetail; onChanged?: () => void }) {
  const { t } = useT();
  const [state, setState] = useState<RowState | undefined>();
  const [page, setPage] = useState(0);
  const rows = useRows(candidate.id, { state, page });
  const counts = rowStateCounts(candidate.counts);
  const items = rows.data?.items ?? [];
  return (
    <Panel title={t("imports.preview.heading")}>
      <div className="flex flex-wrap gap-2" aria-label={t("common.filter")}>
        <Button size="sm" variant={state === undefined ? "primary" : "secondary"} aria-pressed={state === undefined} onClick={() => { setState(undefined); setPage(0); }}>
          {t("common.all")} {candidate.counts.total}
        </Button>
        {counts.map((count) => (
          <Button
            key={count.state}
            size="sm"
            variant={state === count.state ? "primary" : "secondary"}
            aria-pressed={state === count.state}
            onClick={() => { setState(count.state); setPage(0); }}
          >
            {translateKey(t, count.key)} {count.count}
          </Button>
        ))}
      </div>
      <QueryPanel query={rows}>
        {items.length === 0 ? (
          <EmptyState title={t("common.noResults", { query: state ? translateKey(t, rowStateKey(state) ?? "") : t("common.all") })} />
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:hidden">
              {items.map((row) => <RowCard key={row.id} candidate={candidate} row={row} onChanged={onChanged} />)}
            </div>
            <div className="hidden max-w-full overflow-x-auto rounded-card border border-border sm:block" tabIndex={0} role="region" aria-label={t("imports.preview.heading")}>
              <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
                <caption className="sr-only">{candidate.fileName}</caption>
                <thead className="bg-surface-sunken">
                  <tr>
                    <th scope="col" className="px-3 py-2">{t("imports.preview.row")}</th>
                    <th scope="col" className="px-3 py-2">{t("common.filter")}</th>
                    <th scope="col" className="px-3 py-2">{t("common.details")}</th>
                    <th scope="col" className="px-3 py-2">{t("common.moreActions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => <RowLine key={row.id} candidate={candidate} row={row} onChanged={onChanged} />)}
                </tbody>
              </table>
            </div>
          </>
        )}
      </QueryPanel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button size="sm" variant="secondary" disabled={page === 0 || rows.isLoading} onClick={() => setPage((n) => Math.max(0, n - 1))}>{t("common.previousPage")}</Button>
        <span className="font-mono text-[13px] tabular-nums text-muted-foreground">{page + 1}</span>
        <Button size="sm" variant="secondary" disabled={!rows.data?.hasNext || rows.isLoading} onClick={() => setPage((n) => n + 1)}>{t("common.nextPage")}</Button>
      </div>
    </Panel>
  );
}

function RowLine({ candidate, row, onChanged }: { candidate: CandidateDetail; row: StagedRowView; onChanged?: () => void }) {
  const { t } = useT();
  return (
    <tr className="border-t border-border align-top">
      <td className="px-3 py-3 font-mono tabular-nums">{row.rowIndex + 1}</td>
      <td className="px-3 py-3"><RowChip row={row} /></td>
      <td className="max-w-[420px] px-3 py-3"><RowDetails candidate={candidate} row={row} /></td>
      <td className="px-3 py-3"><RowDecision candidate={candidate} row={row} onChanged={onChanged} /></td>
    </tr>
  );
}

function RowCard({ candidate, row, onChanged }: { candidate: CandidateDetail; row: StagedRowView; onChanged?: () => void }) {
  const { t } = useT();
  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-card border border-border p-3" aria-label={`${t("imports.preview.row")} ${row.rowIndex + 1}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[13px] tabular-nums">{t("imports.preview.row")} {row.rowIndex + 1}</span>
        <RowChip row={row} />
      </div>
      <RowDetails candidate={candidate} row={row} />
      <RowDecision candidate={candidate} row={row} onChanged={onChanged} />
    </article>
  );
}

function RowChip({ row }: { row: StagedRowView }) {
  const { t } = useT();
  const key = rowStateKey(row.state);
  return key ? <Chip tone={chipTone(rowTone(row.state))}>{translateKey(t, key)}</Chip> : null;
}

function RowDetails({ candidate, row }: { candidate: CandidateDetail; row: StagedRowView }) {
  const { t } = useT();
  const cells = valueCells(candidate.target, row);
  const diffs = diffEntries(row.diff);
  const lines = refusalLines(row.reasons).map((line) => refusalText((key, vars) => translateKey(t, key, vars), line));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-x-3 gap-y-1 break-words">
        {(cells.length > 0 ? cells : []).map((cell) => (
          <div key={cell.field} className="contents">
            <dt className="text-[13px] text-muted-foreground">{translateKey(t, cell.labelKey)}</dt>
            <dd className="m-0 flex min-w-0 flex-col font-mono text-[13px]">
              {cell.hidden ? (
                <span className="font-sans text-muted-foreground">{t("ingest.rate.hidden")}</span>
              ) : (
                <>
                  <span>
                    {cell.value}
                    {cell.unit ? <span className="text-muted-foreground"> {cell.unit}</span> : null}
                    {cell.unitKey ? <span className="font-sans text-muted-foreground"> {translateKey(t, cell.unitKey)}</span> : null}
                  </span>
                  {cell.entered ? (
                    <span className="font-sans text-[12px] text-muted-foreground">
                      {t("ingest.row.entered")}: {cell.entered.text}{cell.entered.unit ? ` ${cell.entered.unit}` : ""}
                    </span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ))}
        {cells.length === 0
          ? row.raw.map((value, index) => (
              <div key={index} className="contents">
                <dt className="text-[13px] text-muted-foreground">{index + 1}</dt>
                <dd className="m-0 font-mono text-[13px]">{value}</dd>
              </div>
            ))
          : null}
      </dl>
      {diffs.map((diff) => (
        <div key={diff.field} className="rounded-input bg-surface-sunken p-2 text-[13px] break-words">
          <p className="m-0 font-semibold">{translateKey(t, `ingest.field.${diff.field}`)}</p>
          <p className="m-0">{t("ingest.decide.keepLive")}: {diff.live}</p>
          <p className="m-0">{t("ingest.decide.keepFile")}: {diff.file}</p>
        </div>
      ))}
      {lines.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] break-words text-tone-red-ink">
          {lines.map((line, index) => <li key={index}>{line}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function RowDecision({ candidate, row, onChanged }: { candidate: CandidateDetail; row: StagedRowView; onChanged?: () => void }) {
  const { t } = useT();
  const actions = useIngestActions();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<unknown>(null);
  const options = decisionOptions(row);
  if (options.length === 0) return null;
  return (
    <Can do="ingest.upload">
      <div className="flex min-w-[180px] flex-col gap-1">
        <NativeSelect
          aria-label={`${t("common.moreActions")}: ${t("imports.preview.row")} ${row.rowIndex + 1}`}
          value=""
          disabled={pending}
          onChange={async (event) => {
            const option = options[Number(event.currentTarget.value)];
            if (!option) return;
            setPending(true);
            setFailed(null);
            try {
              await actions.decide(candidate.id, [row.id], option.decision, candidate.serverSeq, option.matchId);
              onChanged?.();
            } catch (error) {
              setFailed(error);
            } finally {
              setPending(false);
            }
          }}
        >
          <option value="">{t("common.moreActions")}</option>
          {options.map((option, index) => <option key={`${option.decision}:${option.matchId ?? ""}`} value={index}>{translateKey(t, option.key, option.vars)}</option>)}
        </NativeSelect>
        <ActionError error={failed} />
      </div>
    </Can>
  );
}
