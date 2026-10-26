import { useT } from "@orrn/i18n";
import { useCallback } from "react";

import { minutesParts } from "./model";

/** "4 h 05 min" / "45 min" in the person's language. */
export function useDuration() {
  const { t } = useT();
  return useCallback(
    (min: number) => {
      const { h, m } = minutesParts(min);
      return h > 0 ? t("ageing.duration.hm", { h, m }) : t("ageing.duration.m", { m });
    },
    [t],
  );
}
