import { SegmentedControl } from "@orrn/ui/components/segmented-control";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { monthNames, monthText } from "@/features/reports/model";
import { NUM, ReportActions, ReportTableFrame, TD, TH } from "@/features/reports/report-chrome";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { trpc } from "@/shared/utils/trpc";

import { useCostSettings } from "./hooks";
import { bpText, costBasisNote, csvFile, profitCsv } from "./model";
import { Loaded, Note, RangeFields, useCostSay } from "./ui";

type Group = "section" | "customer" | "month";

/** Row 17: revenue, cost and margin of booked orders. Only for people the server lets see rates. */
export function ProfitTab() {
  const { t } = useCostSay();
  const settings = useCostSettings();
  return (
    <Loaded query={settings}>
      {(s) => (s.ratesAllowed ? <ProfitBody /> : <Note>{t("cost.profit.notAllowed")}</Note>)}
    </Loaded>
  );
}

function ProfitBody() {
  const say = useCostSay();
  const { t } = say;
  const [group, setGroup] = useState<Group>("month");
  const [range, setRange] = useState({ from: "", to: "" });
  const input = { groupBy: group, ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) };
  const profit = useQuery({ ...trpc.costing.profitability.queryOptions(input), meta: INLINE_ERROR_META });
  const months = monthNames(t);
  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="profit-tab">
      <SegmentedControl<Group>
        label={t("cost.profit.groupBy")}
        value={group}
        onChange={setGroup}
        options={[
          { value: "month", label: t("cost.profit.byMonth") },
          { value: "section", label: t("cost.profit.bySection") },
          { value: "customer", label: t("cost.profit.byCustomer") },
        ]}
      />
      <RangeFields from={range.from || profit.data?.from || ""} to={range.to || profit.data?.to || ""} onChange={setRange} />
      <Loaded query={profit}>
        {(data) => (
          <>
            <div className="report-no-print flex flex-wrap gap-2">
              <ReportActions csv={() => ({ name: csvFile(t("cost.profit.csvName"), data.from, data.to), text: profitCsv(data, t, months, monthText) })} />
            </div>
            {data.rows.length === 0 ? (
              <Note>{t("cost.empty")}</Note>
            ) : (
              <ReportTableFrame label={t("cost.tabs.profit")}>
                <table data-testid="profit-table" className="report-table w-full border-collapse text-left text-[13px] leading-5">
                  <caption className="sr-only">{t("cost.tabs.profit")}</caption>
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th scope="col" className={TH}>{t("cost.profit.group")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.lines")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.kg")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.revenue")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.costCol")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.margin")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.marginPct")}</th>
                      <th scope="col" className={`${TH} text-right`}>{t("cost.profit.lowKg")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.rows, null].map((r) => {
                      const row = r ?? data.total;
                      return (
                        <tr key={r?.key ?? "total"} className={r ? "border-b border-border last:border-0" : "border-t border-border font-semibold"}>
                          <th scope="row" className={`${TD} font-medium`}>{r ? (data.groupBy === "month" ? monthText(r.key, months) : r.label) : t("cost.total")}</th>
                          <td className={`${TD} ${NUM}`}>{row.lines}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.kg(row.kgG)}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.money(row.revenuePaise)}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.money(row.costPaise)}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap ${row.marginPaise < 0 ? "text-destructive" : ""}`}>{say.money(row.marginPaise)}</td>
                          <td className={`${TD} ${NUM}`}>{bpText(row.marginBp)}</td>
                          <td className={`${TD} ${NUM} whitespace-nowrap`}>{say.kg(row.lowKgG)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </ReportTableFrame>
            )}
            <div className="flex flex-col gap-1">
              <Note>{t("cost.profit.basisNote", { parts: costBasisNote(data.costBasisKgG, t, say.kgU) || t("cost.basis.none") })}</Note>
              {data.total.noRateKgG > 0 ? <Note>{t("cost.profit.noRate", { kg: say.kgU(data.total.noRateKgG) })}</Note> : null}
              {data.total.noCostKgG > 0 ? <Note>{t("cost.profit.noCost", { kg: say.kgU(data.total.noCostKgG) })}</Note> : null}
              <Note>{t("cost.profit.lowRule", { pct: bpText(data.lowMarginBp) })}</Note>
              {data.truncated ? <Note>{t("cost.profit.truncated")}</Note> : null}
            </div>
          </>
        )}
      </Loaded>
    </div>
  );
}
