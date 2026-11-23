import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";

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

/** A breakdown not closed yet: shown apart with its age, never in the figures. */
export type StillOpenItem = { startMs: number; ageMin: number; workOrderId: string | null; workOrderNumber: string | null };

export type ReportAssetRow = {
  asset: { id: string; code: string; name: string; kind: string; criticality: string };
  stillOpen: readonly StillOpenItem[];
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

/** The age words of an open breakdown: hours and minutes under a day, whole days after. */
export function openAge(ageMin: number): { key: "maint.reports.openFor" | "maint.reports.openForDays"; vars: Record<string, string | number> } {
  if (ageMin < 24 * 60) return { key: "maint.reports.openFor", vars: { time: hoursMinutes(ageMin) } };
  return { key: "maint.reports.openForDays", vars: { n: Math.floor(ageMin / (24 * 60)) } };
}

/** Breakdowns still open, per asset, with their age; left out of every figure until they close. */
export function StillOpenList({ rows }: { rows: readonly ReportAssetRow[] }) {
  const { t } = useT();
  const open = rows.filter((r) => r.stillOpen.length > 0);
  if (open.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-card border border-border bg-card p-4" data-testid="maint-still-open">
      <h2 className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">{t("maint.reports.stillOpen")}</h2>
      <p className="m-0 text-[13px] text-muted-foreground">{t("maint.reports.stillOpenHint")}</p>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-[15px]">
        {open.flatMap((r) =>
          r.stillOpen.map((o) => {
            const age = openAge(o.ageMin);
            return (
              <li key={`${r.asset.id}-${o.workOrderId ?? o.startMs}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-mono font-semibold">{r.asset.code}</span>
                {o.workOrderId && o.workOrderNumber ? (
                  <UiLink to={`/maintenance/work-orders/${o.workOrderId}`} className="font-semibold underline underline-offset-4">
                    {o.workOrderNumber}
                  </UiLink>
                ) : (
                  <span>{t("maint.reports.downtimeEntry")}</span>
                )}
                <span className="text-[13px] text-muted-foreground">{t(age.key, age.vars)}</span>
              </li>
            );
          }),
        )}
      </ul>
    </section>
  );
}
