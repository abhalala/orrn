import { ORRN_DEFAULT_PREFS } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { useMemo } from "react";

import { useMe } from "@/shared/lib/me";

import { plantUnitsFromPrefs, type PlantUnits } from "./plant-units";

/**
 * The plant's units and number style for every Imports screen: the same resolved set as the plant formatter provider
 * (`TenantFmtProvider` reads `me.company.units` too), so an import follows the plant's units like every other screen.
 * It is built for the person's language and the plant's time zone, and is stable while those stay the same.
 */
export function usePlantUnits(): PlantUnits {
  const { locale } = useT();
  const { data: me } = useMe();
  const prefs = me?.company?.units ?? ORRN_DEFAULT_PREFS;
  const settings = me?.company?.settings as { timezone?: unknown } | undefined;
  const zone = typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : "Asia/Kolkata";
  return useMemo(() => plantUnitsFromPrefs(prefs, { locale, timeZone: zone }), [prefs, locale, zone]);
}
