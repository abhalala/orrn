import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { monthNames, monthText } from "@/features/reports/model";
import { NUM, ReportActions, ReportTableFrame, TD, TH } from "@/features/reports/report-chrome";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { bpText, csvFile, forecastCsv, methodText } from "./model";
import { Loaded, Note, useCostSay } from "./ui";

type Group = "plant" | "section" | "customer";

/** Row 52: a plain average of booked orders, its method named, and what it would have said before. */
export function ForecastTab() {
  const say = useCostSay();
  const { t } = say;
  const [group, setGroup] = useState<Group>("plant");
  const q = useQuery({ ...trpc.costing.forecast.queryOptions({ groupBy: group }), meta: INLINE_ERROR_META });
  const months = monthNames(t);
  const groupLabel = t(`cost.forecast.${group}`);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="forecast-tab">
      <SegmentedControl<Group>
        label={t("cost.forecast.groupBy")}
        value={group}
        onChange={setGroup}
        options={(["plant", "section", "customer"] as const).map((g) => ({ value: g, label: t(`cost.forecast.${g}`) }))}
      />
      <Loaded query={q}>
        {(data) => (
          <>
            <div className="report-no-print flex flex-wrap gap-2">
              <ReportActions csv={() => ({ name: csvFile(t("cost.forecast.csvName")), text: forecastCsv(data.rows, t, groupLabel) })} />
            </div>
            {data.rows.length === 0 ? (
              <Note>{t("cost.forecast.none")}</Note>
            ) : (
              <ReportTableFrame label={t("cost.tabs.forecast")}>
                <table data-testid="forecast-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
                  <caption className="sr-only">{t("cost.tabs.forecast")}</caption>
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className={TH}>{t("cost.forecast.name")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.forecast.last12")}</th>
                      <th scope="col" className={TH}>{t("cost.forecast.method")}</th>
                      <th scope="col" className={TH}>{t("cost.forecast.next")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.forecast.error")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((r) => (
                      <tr key={r.key} className="border-b border-border align-top last:border-0">
                        <th scope="row" className={`${TD} font-medium`}>{r.label || t("cost.forecast.plant")}</th>
                        <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.kg(r.last12G)}</td>
                        <td className={TD}>{methodText(r.method, t)}</td>
                        <td className={TD}>
                          {r.forecast.length === 0 ? "-" : (
                            <ul className="m-0 list-none p-0">
                              {r.forecast.map((f) => (
                                <li key={f.month}>{monthText(f.month, months)}: {say.kg(f.g)}</li>
                              ))}
                            </ul>
                          )}
                          {r.backtest.length > 0 ? (
                            <details className="mt-1">
                              <summary className="cursor-pointer text-muted-foreground">{t("cost.forecast.backtest")}</summary>
                              <ul className="m-0 list-none p-0">
                                {r.backtest.map((b) => (
                                  <li key={b.month}>{t("cost.forecast.backtestRow", { month: monthText(b.month, months), forecast: say.kg(b.forecastG), actual: say.kg(b.actualG) })}</li>
                                ))}
                              </ul>
                            </details>
                          ) : null}
                        </td>
                        <td className={`${TD} ${NUM}`}>{bpText(r.errorBp)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ReportTableFrame>
            )}
            <Note>{t("cost.forecast.note")}</Note>
            {data.truncated ? <Note>{t("cost.forecast.truncated")}</Note> : null}
          </>
        )}
      </Loaded>
    </div>
  );
}
