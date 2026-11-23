import { Button } from "@orrn/ui/components/button";
import { Chip } from "@orrn/ui/components/chip";
import { useQuery } from "@tanstack/react-query";

import { monthNames, monthText } from "@/features/reports/model";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useCostSettings } from "./hooks";
import { bpText, costedG, fullestWeek, lowMarginShareBp, methodText } from "./model";
import type { CostTab } from "./search";
import { Loaded, Note, Panel, useCostSay } from "./ui";

const OUTLOOK_WEEKS = 8;

/** Row 92: dies due, press load, the plant forecast and (for rate holders) the low-margin trend, on one page. */
export function OutlookTab({ onTab }: { onTab(tab: CostTab): void }) {
  const say = useCostSay();
  const { t } = say;
  const settings = useCostSettings();
  const dies = useQuery({ ...trpc.costing.dies.queryOptions({ state: "attention", limit: 5 }), meta: INLINE_ERROR_META });
  const cap = useQuery({ ...trpc.costing.capacity.queryOptions({ weeks: OUTLOOK_WEEKS, withForecast: false, scenario: [] }), meta: INLINE_ERROR_META });
  const fc = useQuery({ ...trpc.costing.forecast.queryOptions({ groupBy: "plant" }), meta: INLINE_ERROR_META });
  const ratesAllowed = settings.data?.ratesAllowed === true;
  const margin = useQuery({ ...trpc.costing.profitability.queryOptions({ groupBy: "month" }), enabled: ratesAllowed, meta: INLINE_ERROR_META });
  const months = monthNames(t);
  const more = (tab: CostTab, label: string) => (
    <div>
      <Button variant="ghost" onClick={() => onTab(tab)}>{label}</Button>
    </div>
  );
  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-2" data-testid="outlook-tab">
      <Panel title={t("cost.outlook.diesTitle")}>
        <Loaded query={dies}>
          {(d) => (
            <>
              <p className="m-0 flex flex-wrap gap-2">
                <Chip tone={d.due > 0 ? "red" : "neutral"}>{t("cost.outlook.diesDue", { n: d.due })}</Chip>
                <Chip tone={d.soon > 0 ? "amber" : "neutral"}>{t("cost.outlook.diesSoon", { n: d.soon })}</Chip>
              </p>
              {d.items.length === 0 ? (
                <Note>{t("cost.outlook.diesNone")}</Note>
              ) : (
                <ul className="m-0 list-none p-0 text-[14px]">
                  {d.items.map((r) => (
                    <li key={r.copyId} className="py-1">
                      <span className="font-medium">{t("cost.outlook.diesLine", { code: r.code, section: r.sectionCode })}</span>
                      <br />
                      <span className="text-muted-foreground">
                        {t("cost.outlook.diesWhat", { nitride: t(`cost.dies.state.${r.nitride.state}`), correct: t(`cost.dies.state.${r.correct.state}`) })}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {more("dies", t("cost.outlook.diesAll"))}
            </>
          )}
        </Loaded>
      </Panel>

      <Panel title={t("cost.outlook.capTitle", { n: OUTLOOK_WEEKS })}>
        <Loaded query={cap}>
          {(c) => {
            const worst = fullestWeek(c);
            return (
              <>
                <p className="m-0 text-[15px] font-medium">{c.overWeeks > 0 ? t("cost.outlook.capOver", { n: c.overWeeks }) : t("cost.outlook.capNone")}</p>
                {worst ? (
                  <Note>{t("cost.outlook.capWorst", { line: `${worst.line.code} ${worst.line.name}`, day: say.day(worst.week.start), load: bpText(worst.week.loadBp) })}</Note>
                ) : null}
                {more("capacity", t("cost.outlook.capAll"))}
              </>
            );
          }}
        </Loaded>
      </Panel>

      <Panel title={t("cost.outlook.fcTitle")}>
        <Loaded query={fc}>
          {(f) => {
            const row = f.rows[0];
            if (!row) return <Note>{t("cost.forecast.none")}</Note>;
            const rows = [
              ...row.backtest.map((b) => ({ month: b.month, forecast: b.forecastG, actual: b.actualG as number | null })),
              ...row.forecast.map((x) => ({ month: x.month, forecast: x.g, actual: null as number | null })),
            ];
            return (
              <>
                <Note>{t("cost.outlook.fcMethod", { method: methodText(row.method, t) })}</Note>
                {rows.length === 0 ? null : (
                  <table className="w-full border-collapse text-left text-[13px]" data-testid="outlook-forecast">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th scope="col" className="px-2 py-1 font-medium">{t("cost.outlook.fcMonth")}</th>
                        <th scope="col" className="px-2 py-1 text-right font-medium">{t("cost.outlook.fcForecast")}</th>
                        <th scope="col" className="px-2 py-1 text-right font-medium">{t("cost.outlook.fcActual")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.month} className="border-b border-border last:border-0">
                          <th scope="row" className="px-2 py-1 font-medium">{monthText(r.month, months)}</th>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{say.kg(r.forecast)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{r.actual == null ? "-" : say.kg(r.actual)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {row.errorBp != null ? <Note>{t("cost.outlook.fcError", { pct: bpText(row.errorBp) })}</Note> : null}
                {more("forecast", t("cost.outlook.fcAll"))}
              </>
            );
          }}
        </Loaded>
      </Panel>

      {ratesAllowed ? (
        <Panel title={t("cost.outlook.marginTitle")}>
          <Loaded query={margin}>
            {(m) => {
              const rows = m.rows.map((r) => ({ key: r.key, share: lowMarginShareBp(r.lowKgG, costedG(r)) })).filter((r) => r.share != null);
              return (
                <>
                  <Note>{t("cost.outlook.marginHint", { pct: bpText(m.lowMarginBp) })}</Note>
                  {rows.length === 0 ? (
                    <Note>{t("cost.outlook.marginNone")}</Note>
                  ) : (
                    <ul className="m-0 list-none p-0 text-[14px]" data-testid="outlook-margin">
                      {rows.map((r) => (
                        <li key={r.key} className="flex justify-between gap-3 py-0.5">
                          <span>{monthText(r.key, months)}</span>
                          <span className="font-mono tabular-nums">{bpText(r.share)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {more("profit", t("cost.outlook.marginAll"))}
                </>
              );
            }}
          </Loaded>
        </Panel>
      ) : null}
    </div>
  );
}
