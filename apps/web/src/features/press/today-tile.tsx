import { gToKg, formatKgTotal } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { UiLink } from "@orrn/ui/components/link";
import { StatusBlock } from "@orrn/ui/components/status-block";

import { kgFromG, percentOfBp } from "./model";

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
export function TodayPressTile({ data }: { data: PressedToday }) {
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
