/**
 * The page-level period row (ruling R33): one segmented control that scopes everything below it
 * (the leaderboard and the list's kg column, or a customer's tiles and top sections), with the
 * exact dates spelled out so "This year" reads as the financial year it is.
 */
import { useT } from "@orrn/i18n";
import { SegmentedControl } from "@orrn/ui/components/segmented-control";

import { formatDay } from "./dates";
import { PERIOD_LABEL, PERIODS, type Period } from "./period";

export function PeriodRow({
  period,
  range,
  today,
  onChange,
}: {
  period: Period;
  range: { from: string; to: string };
  today: string;
  onChange(period: Period): void;
}) {
  const { t, locale } = useT();
  return (
    <div data-slot="period-row" className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      <SegmentedControl
        label={t("customers.period.label")}
        value={period}
        onChange={onChange}
        options={PERIODS.map((p) => ({ value: p, label: t(PERIOD_LABEL[p]) }))}
      />
      <p className="m-0 text-[14px] font-medium text-muted-foreground tabular-nums">
        {t("customers.period.range", { from: formatDay(range.from, locale, today), to: formatDay(range.to, locale, today) })}
      </p>
    </div>
  );
}
