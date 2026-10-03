import { chartDateFormat, type BarDatum } from "@orrn/ui/charts";

/** `analytics.dispatchVolume` rows -> bars: kg per month, the last (current, open) month marked partial. */
export function volumeBars(months: readonly { month: string; kgG: number }[], locale: string): BarDatum[] {
  // Mid-month UTC, formatted in UTC: a month label never slips across a boundary.
  const fmt = chartDateFormat("month", locale, "UTC");
  return months.map((m, i) => {
    const [y, mo] = m.month.split("-").map(Number);
    const at = new Date(Date.UTC(y!, (mo ?? 1) - 1, 15));
    return {
      key: m.month,
      label: fmt.long(at),
      short: fmt.short(at),
      value: m.kgG / 1000,
      partial: i === months.length - 1,
    };
  });
}
