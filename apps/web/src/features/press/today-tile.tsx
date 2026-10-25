import { gToKg, formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { Chip } from "@orrn/ui/components/chip";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";

import { kgFromG, percentOfBp } from "./model";

/** `dashboard.today.pressAlerts` (FP-PR-22): null when there is no alert at all. */
export type PressAlertsToday = { open: number; today: number; simulated: boolean } | null;

export type PressedToday = {
  /** Production runs' good kg (the recovery base); trial, sample and other runs are `trialKgG`. */
  kgG: number;
  trialKgG: number;
  trialRuns: number;
  recoveryBp: number | null;
  downtimeMin: number;
  runs: number;
  lateRuns: number;
  lateShareBp: number;
};

/**
 * Today's press tile (press, supervisor, manager): what was logged today, recovery, downtime and
 * the share of runs entered late. Figures are `dashboard.today.pressedToday`, the server's: pressed
 * kg and recovery are production runs only, trial and sample kg is said apart (BACKLOG 53b). The
 * strings are `today.press.*`, a floor namespace gu carries in full (BACKLOG 54).
 */
export function TodayPressTile({ data, alerts = null }: { data: PressedToday; alerts?: PressAlertsToday }) {
  const { t } = useT();
  return (
    <section aria-labelledby="today-press" data-testid="today-press" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="today-press" className="m-0 text-[17px] font-semibold">
          {t("today.press.title")}
        </h2>
        <UiLink to="/press/summary" className="text-[14px] font-semibold text-foreground underline underline-offset-4">
          {t("today.press.open")}
        </UiLink>
      </div>
      {alerts ? (
        <p className="m-0 flex flex-wrap items-center gap-2" data-testid="today-press-alerts">
          {alerts.open > 0 ? <Chip tone="red">{t("press.summary.alertsOpen", { count: alerts.open })}</Chip> : null}
          <Chip tone="amber">{t("press.summary.alertsToday", { count: alerts.today })}</Chip>
          {alerts.simulated ? <Chip tone="blue">{t("press.summary.alertsSimulated")}</Chip> : null}
        </p>
      ) : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatusBlock
          tone="green"
          title={t("today.press.pressed")}
          meta={[t("today.press.runs", { count: data.runs }), data.trialRuns > 0 ? t("today.press.trials", { kg: kgFromG(data.trialKgG) }) : null].filter(Boolean).join(" · ")}
          value={gToKg(data.kgG)}
          unit={t("units.kg")}
          format={formatKgTotal}
          countUp={false}
          href="/press/summary"
        />
        <StatusBlock
          tone="blue"
          title={t("today.press.recovery")}
          meta={t("today.press.recoveryMeta")}
          value={data.recoveryBp == null ? "—" : Number(percentOfBp(data.recoveryBp))}
          unit={data.recoveryBp == null ? undefined : "%"}
          format={(n) => n.toFixed(1)}
          countUp={false}
          href="/press/summary"
        />
        <StatusBlock tone="amber" title={t("today.press.downtime")} meta={t("today.press.stops")} value={data.downtimeMin} unit={t("units.min")} countUp={false} href="/press/summary" />
        <StatusBlock
          tone={data.lateRuns > 0 ? "red" : "neutral"}
          title={t("today.press.late")}
          meta={t("today.press.lateShare", { pct: percentOfBp(data.lateShareBp) })}
          value={data.lateRuns}
          countUp={false}
          href="/press/summary"
        />
      </div>
    </section>
  );
}
