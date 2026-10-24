import { useT } from "@orrn/i18n";
import { useMemo } from "react";

import { formatDay, formatTime, monthNames } from "./format";

/** Day and time formatters bound to the current language's month names. */
export function useFormat() {
  const { t } = useT();
  const months = useMemo(() => monthNames(t("native.monthsShort")), [t]);
  return useMemo(
    () => ({
      day: (value: Parameters<typeof formatDay>[0]) => formatDay(value, months),
      time: (value: Parameters<typeof formatTime>[0]) => formatTime(value),
    }),
    [months],
  );
}
