import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { useCompanyWhen } from "@/features/stock/use-company-when";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import type { QaRunView } from "./hooks";
import { tenthsText } from "./model";
import { ResultChip } from "./ui";

const METRIC_KEY = { billet_temp: "qa.plans.billetTemp", exit_temp: "qa.plans.exitTemp", ram_speed: "qa.plans.ramSpeed" } as const;

/** One run's quality (rows 24, 28, 39): first piece, in-process checks and whether one is due, plan flags. */
export function RunQualityBody({ data }: { data: QaRunView }) {
  const { t } = useT();
  const when = useCompanyWhen();
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4 sm:p-5" data-testid="qa-run">
      <h3 className="m-0 text-[17px] font-semibold">{t("qa.run.title", { number: data.run.number })}</h3>
      <div className="flex flex-wrap items-center gap-2" data-testid="qa-run-first-piece">
        <span className="text-[14px] font-semibold">{t("qa.run.firstPiece")}</span>
        {data.firstPiece ? <ResultChip result={data.firstPiece.result} /> : <Chip tone="amber">{t("qa.run.notChecked")}</Chip>}
        {data.firstPiece ? <span className="text-[14px] text-muted-foreground">{when(data.firstPiece.checkedAt)}</span> : null}
      </div>
      {data.firstPieceBlocksPack && data.firstPieceState !== "passed" ? <p className="m-0 text-[14px] text-tone-amber-ink">{t("qa.run.blocksPack")}</p> : null}
      <div className="flex flex-col gap-1" data-testid="qa-run-in-process">
        <span className="text-[14px] font-semibold">{t("qa.run.inProcess")}</span>
        <p className="m-0 text-[14px]" data-testid="qa-run-due">
          {data.inProcessDue.due ? t("qa.run.due", { count: data.inProcessDue.bundlesSince }) : t("qa.run.notDue")}
        </p>
        {data.inProcess.length > 0 ? (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {data.inProcess.map((c) => (
              <li key={c.id} className="flex items-center gap-1.5 text-[13px]">
                <ResultChip result={c.result} />
                <span className="text-muted-foreground">{when(c.checkedAt)}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <div className="flex flex-col gap-1" data-testid="qa-run-breaches">
        <span className="text-[14px] font-semibold">{t("qa.run.breaches")}</span>
        {!data.plan ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("qa.run.noPlan")}</p>
        ) : data.breaches.length === 0 ? (
          <p className="m-0 text-[14px] text-muted-foreground">{t("qa.run.noBreaches")}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {data.breaches.map((b) => (
              <li key={`${b.metric}-${b.direction}`} className="text-[14px] text-tone-red-ink" data-breach={b.metric}>
                {t(METRIC_KEY[b.metric])}: {tenthsText(b.valueX10)} ({b.direction === "low" ? t("qa.plans.min") : t("qa.plans.max")} {tenthsText(b.limitX10)})
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function RunQualityPanel({ runId }: { runId: string }) {
  const { t } = useT();
  const q = useQuery({ ...trpc.qa.run.queryOptions({ runId }), meta: INLINE_ERROR_META });
  if (q.isError) return <p className="m-0 text-[14px] text-muted-foreground">{t("qa.run.notFound")}</p>;
  if (!q.data) return null;
  return <RunQualityBody data={q.data} />;
}
