import { chartDateFormat, type BarDatum } from "@orrn/ui/charts";

/**
 * `analytics.dispatchVolume` rows -> bars: kg per month, the last (current,
 * open) month marked partial. Each bar carries its month (`t`) so the axis
 * writes "Nov 25 ... Jan 26 ... Oct" instead of two bare "Oct" ticks.
 */
export function volumeBars(months: readonly { month: string; kgG: number }[], locale: string): BarDatum[] {
  // Mid-month UTC, formatted in UTC: a month label never slips across a boundary.
  const fmt = volumeDateFormat(locale);
  return months.map((m, i) => {
    const [y, mo] = m.month.split("-").map(Number);
    const at = new Date(Date.UTC(y!, (mo ?? 1) - 1, 15));
    return {
      key: m.month,
      label: fmt.long(at),
      short: fmt.short(at),
      t: at,
      value: m.kgG / 1000,
      partial: i === months.length - 1,
    };
  });
}

/** Month ticks and names in UTC, matching the mid-month UTC dates of `volumeBars`. */
export function volumeDateFormat(locale: string) {
  return chartDateFormat("month", locale, "UTC");
}
