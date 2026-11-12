import { useT } from "@orrn/i18n";
import { useMemo } from "react";

import { useMe } from "@/shared/lib/me";

import { plantUnitsFor, type PlantUnits } from "./plant-units";

/**
 * The plant's units and number style for every Imports screen. The formatter comes from `@orrn/domain`, built from
 * the orrn default preferences and the plant's own settings, for the person's language and the plant's time zone.
 * The result is stable while the settings and language stay the same, so it is safe in a dependency list.
 *
 * When the plant settings provider merges, replace the body of this hook with that provider's formatter; the
 * `PlantUnits` shape stays the same.
 */
export function usePlantUnits(): PlantUnits {
  const { locale } = useT();
  const { data: me } = useMe();
  const settings = me?.company?.settings ?? null;
  const zone = settings && typeof (settings as { timezone?: unknown }).timezone === "string" ? (settings as { timezone: string }).timezone : "Asia/Kolkata";
  return useMemo(() => plantUnitsFor(settings, { locale, timeZone: zone }), [settings, locale, zone]);
}
