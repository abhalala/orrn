import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { Chip } from "@orrn/ui/components/chip";
import { useId, type ReactNode } from "react";

import { planIntervalWords, warrantyState } from "./asset-model";
import { WO_STATUS_TONE, hoursMinutes, isWoKind, isWoStatus } from "./model";

/** A titled card, the same frame for every section of the asset screen. */
export function Section({ title, hint, actions, children, testId }: { title: string; hint?: string; actions?: ReactNode; children: ReactNode; testId?: string }) {
  const hid = useId();
  return (
    <section aria-labelledby={hid} data-testid={testId} className="flex min-w-0 flex-col gap-3 rounded-card border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={hid} className="m-0 font-display text-[19px] font-bold tracking-[-0.02em]">
            {title}
          </h2>
          {hint ? <p className="m-0 text-[13px] leading-5 text-muted-foreground">{hint}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Facts({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{r.label}</dt>
          <dd className="m-0 mt-0.5 text-[15px] break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** "Under warranty until 3 Oct 2027" or "Warranty ended 3 Oct 2025", by comparing company days. */
export function WarrantyLine({ until, today, day }: { until: string | null; today: string; day: (ymd: string) => string }) {
  const { t } = useT();
  const w = warrantyState(until, today);
  if (!w) return <>{t("maint.assets.detail.noWarranty")}</>;
  return <>{w.state === "under" ? t("maint.assets.detail.underWarranty", { day: day(w.day) }) : t("maint.assets.detail.warrantyEnded", { day: day(w.day) })}</>;
}

/** "Every 30 days", "Every 500 run hours" or both. */
export function PlanInterval({ days, hours }: { days: number | null; hours: number | null }) {
  const { t } = useT();
  const w = planIntervalWords(days, hours);
  return <>{w ? t(w.key, w.vars) : ""}</>;
}

export type HistoryRow = {
  id: string;
  number: string;
  kind: string;
  status: string;
  title: string;
  createdAt: number;
  finishedAt: number | null;
  labourMin: number;
};

/** The service history table body: one row per work order on the asset. */
export function HistoryTable({ rows, date }: { rows: readonly HistoryRow[]; date: (at: number) => string }) {
  const { t } = useT();
  const th = "whitespace-nowrap px-3 py-2 font-medium";
  const td = "px-3 py-2";
  return (
    <div className="min-w-0 overflow-x-auto rounded-card border border-border" tabIndex={0} role="region" aria-label={t("maint.assets.history.title")}>
      <table className="w-full border-collapse text-left text-[14px]" data-testid="asset-history">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className={th}>{t("maint.assets.history.cols.number")}</th>
            <th scope="col" className={th}>{t("maint.assets.history.cols.kind")}</th>
            <th scope="col" className={th}>{t("maint.assets.history.cols.status")}</th>
            <th scope="col" className={th}>{t("maint.assets.history.cols.title")}</th>
            <th scope="col" className={th}>{t("maint.assets.history.cols.raised")}</th>
            <th scope="col" className={th}>{t("maint.assets.history.cols.finished")}</th>
            <th scope="col" className={`${th} text-right`}>{t("maint.assets.history.cols.labour")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id} className="border-b border-border last:border-0">
              <td className={`${td} whitespace-nowrap font-mono font-semibold`}>
                <UiLink to={`/maintenance/work-orders/${h.id}`} className="text-foreground underline underline-offset-4">
                  {h.number}
                </UiLink>
              </td>
              <td className={td}>{isWoKind(h.kind) ? t(`maint.woKind.${h.kind}`) : h.kind}</td>
              <td className={td}>
                {isWoStatus(h.status) ? (
                  <Chip tone={WO_STATUS_TONE[h.status]} truncate={false}>
                    {t(`maint.woStatus.${h.status}`)}
                  </Chip>
                ) : (
                  h.status
                )}
              </td>
              <td className={`${td} min-w-[10rem]`}>{h.title}</td>
              <td className={`${td} whitespace-nowrap`}>{date(h.createdAt)}</td>
              <td className={`${td} whitespace-nowrap`}>{h.finishedAt == null ? "" : date(h.finishedAt)}</td>
              <td className={`${td} whitespace-nowrap text-right font-mono tabular-nums`}>{h.labourMin > 0 ? hoursMinutes(h.labourMin) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type SpareRow = {
  linkId: string;
  workOrderId: string;
  workOrderNumber: string;
  number: string;
  itemName: string;
  unit: string;
  qtyMilli: number;
  issuedAt: number;
  cancelledAt: number | null;
};

/** Spares used on the asset. Quantity is in the item's own unit as the store keeps it. */
export function SparesTable({ rows, date, qty }: { rows: readonly SpareRow[]; date: (at: number) => string; qty: (milli: number) => string }) {
  const { t } = useT();
  const th = "whitespace-nowrap px-3 py-2 font-medium";
  const td = "px-3 py-2";
  return (
    <div className="min-w-0 overflow-x-auto rounded-card border border-border" tabIndex={0} role="region" aria-label={t("maint.assets.spares.title")}>
      <table className="w-full border-collapse text-left text-[14px]" data-testid="asset-spares">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th scope="col" className={th}>{t("maint.assets.spares.cols.workOrder")}</th>
            <th scope="col" className={th}>{t("maint.assets.spares.cols.entry")}</th>
            <th scope="col" className={th}>{t("maint.assets.spares.cols.item")}</th>
            <th scope="col" className={`${th} text-right`}>{t("maint.assets.spares.cols.qty")}</th>
            <th scope="col" className={th}>{t("maint.assets.spares.cols.issued")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.linkId} className="border-b border-border last:border-0">
              <td className={`${td} whitespace-nowrap font-mono font-semibold`}>
                <UiLink to={`/maintenance/work-orders/${s.workOrderId}`} className="text-foreground underline underline-offset-4">
                  {s.workOrderNumber}
                </UiLink>
              </td>
              <td className={`${td} whitespace-nowrap font-mono`}>{s.number}</td>
              <td className={td}>
                {s.itemName}
                {s.cancelledAt != null ? (
                  <span className="mt-0.5 block">
                    <Chip tone="neutral" truncate={false}>
                      {t("maint.assets.spares.cancelled")}
                    </Chip>
                  </span>
                ) : null}
              </td>
              <td className={`${td} whitespace-nowrap text-right font-mono tabular-nums`}>{`${qty(s.qtyMilli)} ${s.unit}`}</td>
              <td className={`${td} whitespace-nowrap`}>{date(s.issuedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

