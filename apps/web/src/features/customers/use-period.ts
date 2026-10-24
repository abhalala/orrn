/**
 * The customer screens' period: the `period` search param when present, else the period last
 * picked in this browser tab (so opening a customer from the leaderboard keeps "This month"),
 * else this financial year. Ranges end today on the company's calendar.
 */
import { useMemo } from "react";

import { useMe } from "@/shared/lib/me";

import { companyTimeZone, DEFAULT_PERIOD, parsePeriod, periodRange, todayIn, trailingMonths, type Period } from "./period";

const STORAGE_KEY = "orrn.customers.period";

export function rememberedPeriod(): Period {
  try {
    return parsePeriod(window.sessionStorage.getItem(STORAGE_KEY) ?? DEFAULT_PERIOD);
  } catch {
    return DEFAULT_PERIOD;
  }
}

export function rememberPeriod(period: Period) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, period);
  } catch {
    // Private mode or blocked storage: the URL still carries the choice.
  }
}

/** Search-param reader: absent stays absent (the hook falls back), unknown values are dropped. */
export function periodSearch(value: unknown): Period | undefined {
  return value === undefined ? undefined : parsePeriod(value);
}

export type PeriodState = {
  period: Period;
  timeZone: string;
  today: string;
  range: { from: string; to: string };
  months: ReturnType<typeof trailingMonths>;
};

export function usePeriod(fromUrl: Period | undefined): PeriodState {
  const { data: me } = useMe();
  const timeZone = companyTimeZone(me?.company?.settings);
  const period = fromUrl ?? rememberedPeriod();
  const today = todayIn(timeZone);
  return useMemo(
    () => ({ period, timeZone, today, range: periodRange(period, today), months: trailingMonths(today) }),
    [period, timeZone, today],
  );
}
