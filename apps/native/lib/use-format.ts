import { useT } from "@orrn/i18n";
import { useMemo } from "react";

import { useMe } from "@/utils/me";

import { formatDay, formatTime, monthNames, zoneOf } from "./format";

/**
 * Day and time formatters bound to the current language's month names and to the company's time zone
 * (`me.company.settings.timezone`, IST when unset), so a phone set to another zone still shows the plant's clock.
 */
export function useFormat() {
  const { t } = useT();
  const { data: me } = useMe();
  const zone = zoneOf(me?.company?.settings as { [key: string]: unknown } | null | undefined);
  const months = useMemo(() => monthNames(t("native.monthsShort")), [t]);
  return useMemo(
    () => ({
      zone,
      day: (value: Parameters<typeof formatDay>[0]) => formatDay(value, months, new Date(), zone),
      time: (value: Parameters<typeof formatTime>[0]) => formatTime(value, zone),
      /** A ship date: the server keeps it as UTC midnight of the day, so it is read in UTC and never shifts. */
      shipDay: (value: Parameters<typeof formatDay>[0]) => formatDay(value, months, new Date(), "UTC"),
    }),
    [months, zone],
  );
}
