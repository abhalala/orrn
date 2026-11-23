import { useT } from "@orrn/i18n";

import { NUM, TD, TH } from "../reports/report-chrome";
import { hoursFromMinutes } from "./asset-model";
import { hoursMinutes } from "./model";

export type ReportFigures = {
  failures: number;
  downtimeMin: number;
  mttrMin: number | null;
  mtbfMin: number | null;
  labourMin: number;
  sparesEntries: number;
  labourPaise: number | null;
};

export type ReportAssetRow = {
  asset: { id: string; code: string; name: string; kind: string; criticality: string };
  months: (ReportFigures & { month: string })[];
  total: ReportFigures;
};

function Cells({ f, money, showMoney, strong }: { f: ReportFigures; money: (paise: number) => string; showMoney: boolean; strong?: boolean }) {
  const cls = `${TD} ${NUM} whitespace-nowrap${strong ? " font-semibold" : ""}`;
  return (
    <>
      <td className={cls}>{f.failures}</td>
      <td className={cls}>{f.downtimeMin > 0 ? hoursMinutes(f.downtimeMin) : "0:00"}</td>
      <td className={cls}>{f.mttrMin == null ? "" : hoursMinutes(f.mttrMin)}</td>
      <td className={cls}>{f.mtbfMin == null ? "" : hoursFromMinutes(f.mtbfMin)}</td>
      <td className={cls}>{f.labourMin > 0 ? hoursMinutes(f.labourMin) : "0:00"}</td>
      <td className={cls}>{f.sparesEntries}</td>
      {showMoney ? <td className={cls}>{f.labourPaise == null ? "" : money(f.labourPaise)}</td> : null}
    </>
  );
}

function Heads({ first, showMoney }: { first: string; showMoney: boolean }) {
  const { t } = useT();
  return (
    <tr className="border-b border-border text-muted-foreground">
      <th scope="col" className={TH}>{first}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.breakdowns")}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.downtime")}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.repair")}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.between")}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.labour")}</th>
      <th scope="col" className={`${TH} text-right`}>{t("maint.reports.spares")}</th>
      {showMoney ? <th scope="col" className={`${TH} text-right`}>{t("maint.reports.labourCost")}</th> : null}
    </tr>
  );
}

/** One row per asset: the figures of the whole range. */
export function TotalsTable({ rows, showMoney, money, assetLabel }: { rows: readonly ReportAssetRow[]; showMoney: boolean; money: (paise: number) => string; assetLabel: string }) {
  return (
    <table data-testid="maint-report-totals" className="report-table w-full border-collapse text-left text-[13px] leading-5">
      <caption className="sr-only">{assetLabel}</caption>
      <thead>
        <Heads first={assetLabel} showMoney={showMoney} />
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.asset.id} className="border-b border-border last:border-0" data-asset={r.asset.code}>
            <th scope="row" className={`${TD} min-w-[9rem] text-left`}>
              <span className="font-mono font-semibold whitespace-nowrap">{r.asset.code}</span> {r.asset.name}
            </th>
            <Cells f={r.total} money={money} showMoney={showMoney} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One row per month of one asset, then the range total. */
export function MonthsTable({ row, showMoney, money }: { row: ReportAssetRow; showMoney: boolean; money: (paise: number) => string }) {
  const { t } = useT();
  return (
    <table data-testid="maint-report-months" className="report-table w-full border-collapse text-left text-[13px] leading-5">
      <caption className="sr-only">{`${row.asset.code} ${row.asset.name}`}</caption>
      <thead>
        <Heads first={t("maint.reports.month")} showMoney={showMoney} />
      </thead>
      <tbody>
        {row.months.map((m) => (
          <tr key={m.month} className="border-b border-border" data-month={m.month}>
            <th scope="row" className={`${TD} whitespace-nowrap text-left font-mono`}>{m.month}</th>
            <Cells f={m} money={money} showMoney={showMoney} />
          </tr>
        ))}
        <tr data-total>
          <th scope="row" className={`${TD} whitespace-nowrap text-left`}>{t("maint.reports.total")}</th>
          <Cells f={row.total} money={money} showMoney={showMoney} strong />
        </tr>
      </tbody>
    </table>
  );
}
