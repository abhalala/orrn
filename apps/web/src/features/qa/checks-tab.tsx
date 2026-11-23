import type { QaCheckKind } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { EmptyState } from "@orrn/ui/components/empty-state";
import { Field, TextInput } from "@orrn/ui/components/field";
import { ResponsiveList, type ResponsiveListColumn } from "@orrn/ui/components/responsive-list";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { Can } from "@/shared/components/can";
import { INLINE_ERROR_META, showsQueryError } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { CheckSheet } from "./check-sheet";
import type { QaCheckRow } from "./hooks";
import { flagNames } from "./model";
import { RunQualityPanel } from "./run-panel";
import { QA_KINDS, QA_STAGE_LIST, type QaKind, type QaSearch, type QaStageId } from "./search";
import { Block, QaSelect, ResultChip } from "./ui";

const PAGE = 50;

type Say = (key: string, vars?: Record<string, string | number>) => string;

/** What a check row says beside its result: flagged dimensions, low test values, readings, the standard. */
export function checkDetail(say: Say, row: Pick<QaCheckRow, "flags" | "values" | "standard" | "operatorName" | "note">): string {
  const parts: string[] = [];
  const { flagged, low, unchecked } = flagNames(row.flags);
  const propNames = (list: string[]) => list.map((n) => say(`qa.sheet.mech.${n}`).replace(/ \(.*\)$/, "")).join(", ");
  if (flagged.length) parts.push(say("qa.checks.flagged", { names: flagged.join(", ") }));
  if (low.length) parts.push(say("qa.checks.low", { names: propNames(low) }));
  if (unchecked.length) parts.push(say("qa.checks.unchecked", { names: propNames(unchecked) }));
  const values = (row.values ?? {}) as { readings?: { name: string; value: string }[]; limits?: unknown; tensileMpa?: unknown };
  // Review S3: a mechanical test with no temper says so (its result reads "Not checked").
  if ("tensileMpa" in values && values.limits === null) parts.push(say("qa.checks.noLimits"));
  if (Array.isArray(values.readings) && values.readings.length) parts.push(values.readings.map((r) => `${r.name}: ${r.value}`).join(", "));
  if (row.standard) parts.push(`${say("qa.sheet.standard")}: ${row.standard}`);
  if (row.operatorName) parts.push(`${say("qa.sheet.operator")}: ${row.operatorName}`);
  if (row.note) parts.push(row.note);
  return parts.join("; ");
}

/**
 * The registers (rows 22 to 27, 39): one list of checks filtered by kind, and by stage for clearances.
 * A run number shows that run's first piece, in-process checks and plan flags above its checks.
 */
export function ChecksTab({ kind, stage, runId, onSearch }: { kind?: QaKind; stage?: QaStageId; runId?: string; onSearch(next: Omit<QaSearch, "tab">): void }) {
  const { t } = useT();
  const when = useCompanyWhen();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [recording, setRecording] = useState(false);
  const [runNumber, setRunNumber] = useState("");
  const [runMissing, setRunMissing] = useState(false);
  useEffect(() => setOffset(0), [kind, stage, runId]);
  const list = useQuery({
    ...trpc.qa.checks.list.queryOptions({
      limit: PAGE,
      cursor: offset,
      ...(kind ? { kind } : {}),
      ...(kind === "clearance" && stage ? { stage } : {}),
      ...(runId ? { pressRunId: runId } : {}),
    }),
    placeholderData: keepPreviousData,
    meta: INLINE_ERROR_META,
  });
  const base = { ...(kind ? { kind } : {}), ...(kind === "clearance" && stage ? { stage } : {}) };

  const findRun = async () => {
    if (!runNumber.trim()) return;
    try {
      const hit = await queryClient.fetchQuery(trpc.qa.findSubject.queryOptions({ subjectType: "press_run", number: runNumber.trim() }));
      setRunMissing(!hit);
      if (hit) onSearch({ ...base, run: hit.id });
    } catch {
      setRunMissing(true);
    }
  };

  const columns: ResponsiveListColumn<QaCheckRow>[] = [
    {
      key: "subject",
      header: t("qa.checks.subject"),
      cell: (r) => (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono whitespace-nowrap font-semibold">{r.subjectNumber}</span>
          <span className="text-[13px] text-muted-foreground">
            {t(`qa.subject.${r.subjectType}`)} · {t(`qa.kind.${r.kind}`)}
            {r.stage ? ` · ${t(`qa.stage.${r.stage}`)}` : ""}
          </span>
        </span>
      ),
    },
    { key: "result", header: t("qa.checks.result"), cell: (r) => <ResultChip result={r.result} /> },
    { key: "detail", header: t("qa.checks.detail"), phoneWide: true, hideWhenEmpty: true, cell: (r) => checkDetail(t as unknown as Say, r) || null },
    { key: "station", header: t("qa.checks.station"), hideOnPhone: true, cell: (r) => r.station ?? "-" },
    {
      key: "when",
      header: t("qa.checks.when"),
      cell: (r) => (
        <span className="flex flex-col gap-0.5 text-[14px]">
          <span>{when(r.checkedAt)}</span>
          {r.checkedBy ? <span className="text-muted-foreground">{r.checkedBy}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <Block
        id="qa-checks"
        title={kind ? t(`qa.kind.${kind}`) : t("qa.checks.all")}
        actions={
          <Can do="qa.check">
            <Button onClick={() => setRecording(true)} aria-haspopup="dialog" data-testid="qa-record-open">
              {t("qa.checks.record")}
            </Button>
          </Can>
        }
      >
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field label={t("qa.checks.kindFilter")}>
              <QaSelect value={kind ?? ""} onChange={(e) => onSearch(e.currentTarget.value ? { kind: e.currentTarget.value as QaKind } : {})} data-testid="qa-kind-filter">
                <option value="">{t("qa.checks.all")}</option>
                {QA_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`qa.kind.${k}`)}
                  </option>
                ))}
              </QaSelect>
            </Field>
          </div>
          {kind === "clearance" ? (
            <div className="w-44">
              <Field label={t("qa.sheet.stage")}>
                <QaSelect value={stage ?? ""} onChange={(e) => onSearch({ kind, ...(e.currentTarget.value ? { stage: e.currentTarget.value as QaStageId } : {}) })} data-testid="qa-stage-filter">
                  <option value="">{t("qa.waiting.allStations")}</option>
                  {QA_STAGE_LIST.map((s) => (
                    <option key={s} value={s}>
                      {t(`qa.stage.${s}`)}
                    </option>
                  ))}
                </QaSelect>
              </Field>
            </div>
          ) : null}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void findRun();
            }}
          >
            <div className="w-48">
              <Field label={t("qa.run.find")} hint={t("qa.run.findHint")} error={runMissing ? t("qa.run.notFound") : undefined}>
                <TextInput value={runNumber} maxLength={64} className="font-mono" onChange={(e) => setRunNumber(e.currentTarget.value)} data-testid="qa-run-number" />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              {t("qa.run.show")}
            </Button>
          </form>
        </div>
        {runId ? <RunQualityPanel runId={runId} /> : null}
        {showsQueryError(list) ? (
          <EmptyState title={t("qa.loadFailed")} action={<Button variant="secondary" onClick={() => void list.refetch()}>{t("common.retry")}</Button>} />
        ) : (
          <ResponsiveList
            rows={list.data?.items ?? []}
            columns={columns}
            rowKey={(r) => r.id}
            loading={list.isLoading}
            label={kind ? t(`qa.kind.${kind}`) : t("qa.checks.all")}
            empty={<EmptyState title={t("qa.checks.empty")} />}
            page={list.data && (offset > 0 || list.data.nextCursor !== null) ? { offset, limit: PAGE, onChange: setOffset } : undefined}
          />
        )}
      </Block>
      <CheckSheet open={recording} onOpenChange={setRecording} preset={{ ...(kind ? { kind: kind as QaCheckKind } : {}), ...(kind === "clearance" && stage ? { stage } : {}) }} />
    </>
  );
}
