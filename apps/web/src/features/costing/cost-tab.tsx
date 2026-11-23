import { COST_STAGES } from "@orrn/domain";
import { Button } from "@orrn/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { NUM, ReportActions, ReportTableFrame, TD, TH } from "@/features/reports/report-chrome";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { costCsv, csvFile, metalLine, nextRunsLimit, RUNS_MAX, RUNS_STEP, stageLine, stageNames } from "./model";
import { Loaded, Note, Panel, RangeFields, useCostSay } from "./ui";
import type { RunView, SectionsView } from "./hooks";

/** Row 16: cost per good kg by section over a range, and one section's runs with every input used. */
export function CostTab() {
  const say = useCostSay();
  const { t } = say;
  const [range, setRange] = useState({ from: "", to: "" });
  const [open, setOpen] = useState<{ id: string; code: string } | null>(null);
  const input = { ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const sections = useQuery({ ...trpc.costing.sections.queryOptions(input), meta: INLINE_ERROR_META });
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="cost-tab">
      <RangeFields from={range.from || sections.data?.from || ""} to={range.to || sections.data?.to || ""} onChange={(r) => { setRange(r); setOpen(null); }} />
      <Loaded query={sections}>
        {(data) => (
          <>
            <div className="report-no-print flex flex-wrap gap-2">
              <ReportActions csv={() => ({ name: csvFile(t("cost.csv.cost"), data.from, data.to), text: costCsv(data, t) })} />
            </div>
            <SectionsTable data={data} onOpen={(id, code) => setOpen({ id, code })} />
            <div className="flex flex-col gap-1">
              {data.ratesFrom ? <Note>{t("cost.cost.ratesFrom", { date: say.day(data.ratesFrom) })}</Note> : <Note>{t("cost.cost.noRates")}</Note>}
              {data.missing.length > 0 ? <Note>{t("cost.cost.missing", { stages: stageNames(data.missing, t) })}</Note> : null}
              {data.total.unknownG > 0 ? <Note>{t("cost.cost.unknownKg", { kg: say.kgU(data.total.unknownG) })}</Note> : null}
              {data.truncated ? <Note>{t("cost.cost.truncated")}</Note> : null}
            </div>
          </>
        )}
      </Loaded>
      {open ? <RunsPanel sectionId={open.id} code={open.code} from={range.from} to={range.to} /> : null}
    </div>
  );
}

function SectionsTable({ data, onOpen }: { data: SectionsView; onOpen(id: string, code: string): void }) {
  const say = useCostSay();
  const { t } = say;
  const money = (p: number | null | undefined) => (p == null ? "-" : say.rate(p));
  if (data.rows.length === 0) return <Note>{t("cost.empty")}</Note>;
  const line = (r: SectionsView["total"]) => (
    <>
      <td className={`${TD} ${NUM}`}>{r.runs}</td>
      <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.kg(r.goodG)}</td>
      <td className={`${TD} ${NUM}`}>{r.recoveryBp == null ? "-" : `${(r.recoveryBp / 100).toFixed(1)}%`}</td>
      <td className={`${TD} ${NUM}`}>{money(r.metalPaisePerKg)}</td>
      {COST_STAGES.map((s) => (
        <td key={s} className={`${TD} ${NUM}`}>{money(r.stages[s])}</td>
      ))}
      <td className={`${TD} ${NUM} font-semibold`}>{money(r.totalPaisePerKg)}</td>
    </>
  );
  return (
    <ReportTableFrame label={t("cost.tabs.cost")}>
      <table data-testid="cost-sections" className="report-table w-full border-collapse text-left text-[13px] leading-5">
        <caption className="sr-only">{t("cost.tabs.cost")}</caption>
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className={TH}>{t("cost.cost.section")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("cost.cost.runs")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("cost.cost.good")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("cost.cost.recovery")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("cost.cost.metal")}</th>
            {COST_STAGES.map((s) => (
              <th key={s} scope="col" className={`${TH} text-right`}>{t(`cost.stage.${s}`)}</th>
            ))}
            <th scope="col" className={`${TH} text-right`}>{t("cost.cost.total")}</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.sectionId} className="border-b border-border last:border-0">
              <th scope="row" className={`${TD} font-medium`}>
                <Button variant="ghost" onClick={() => onOpen(r.sectionId, r.sectionCode)} aria-label={`${t("cost.cost.openRuns")}: ${r.sectionCode}`}>
                  {r.sectionCode}
                </Button>
              </th>
              {line(r)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-semibold" data-testid="cost-total">
            <th scope="row" className={TD}>{t("cost.total")}</th>
            {line(data.total)}
          </tr>
        </tfoot>
      </table>
    </ReportTableFrame>
  );
}

function RunsPanel({ sectionId, code, from, to }: { sectionId: string; code: string; from: string; to: string }) {
  const say = useCostSay();
  const { t } = say;
  const [limit, setLimit] = useState(RUNS_STEP);
  const runs = useQuery({
    ...trpc.costing.runs.queryOptions({ sectionId, limit, ...(from ? { from } : {}), ...(to ? { to } : {}) }),
    meta: INLINE_ERROR_META,
  });
  return (
    <Panel title={t("cost.cost.runsTitle", { section: code })} testId="cost-runs">
      <Loaded query={runs}>
        {(data) =>
          data.items.length === 0 ? (
            <Note>{t("cost.cost.runsEmpty")}</Note>
          ) : (
            <>
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {data.items.map((r) => (
                  <li key={r.id} className="rounded-card border border-border px-3 py-2">
                    <RunBlock run={r} />
                  </li>
                ))}
              </ul>
              {data.nextOffset != null && limit < RUNS_MAX ? (
                <div>
                  <Button variant="secondary" onClick={() => setLimit(nextRunsLimit(limit))}>{t("cost.cost.runsMore")}</Button>
                </div>
              ) : null}
              {(data.nextOffset != null || data.capped) && limit >= RUNS_MAX ? <Note>{t("cost.cost.runsCapped", { n: RUNS_MAX })}</Note> : null}
            </>
          )
        }
      </Loaded>
    </Panel>
  );
}

function RunBlock({ run }: { run: RunView }) {
  const say = useCostSay();
  const { t } = say;
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[14px]">
      <p className="m-0 font-medium">
        {t("cost.cost.number")} {run.number} · {say.day(run.productionDay)}
        {run.copyCode ? ` · ${run.copyCode}` : ""}
      </p>
      <p className="m-0 text-muted-foreground">
        {t("cost.cost.input")} {say.kg(run.inputG)}, {t("cost.cost.good")} {say.kg(run.goodG)}, {t("cost.cost.recovery")}{" "}
        {run.recoveryBp == null ? "-" : `${(run.recoveryBp / 100).toFixed(1)}%`}
      </p>
      <p className="m-0">{metalLine(run.metal, say)}</p>
      <ul className="m-0 list-none p-0">
        {run.losses.map((l) => (
          <li key={l.kind}>
            {l.g == null || l.paisePerKg == null
              ? t(`cost.cost.loss.${l.kind}`)
              : t("cost.cost.lossLine", { kind: t(`cost.cost.loss.${l.kind}`), kg: say.kgU(l.g), rate: say.rate(l.paisePerKg) })}
          </li>
        ))}
        {run.stages.map((s) => (
          <li key={s.stage}>{stageLine(s, say)}</li>
        ))}
      </ul>
      <p className="m-0 font-medium">{run.totalPaisePerKg == null ? t("cost.cost.unknown") : t("cost.cost.totalLine", { rate: say.rate(run.totalPaisePerKg) })}</p>
      <Note>{run.ratesFrom ? t("cost.cost.ratesFromRun", { date: say.day(run.ratesFrom) }) : t("cost.cost.noRatesRun")}</Note>
    </div>
  );
}
