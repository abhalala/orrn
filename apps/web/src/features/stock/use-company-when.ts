import { useT } from "@orrn/i18n";
import { useCallback } from "react";

import { useMe } from "@/shared/lib/me";

import { DEFAULT_TIMEZONE, formatWhen } from "./format";

/** `formatWhen` bound to the company's timezone (settings.timezone, else Asia/Kolkata) and the UI language. */
export function useCompanyWhen(): (at: string | number | Date) => string {
  const { locale } = useT();
  const { data: me } = useMe();
  const settings = (me?.company?.settings ?? {}) as { timezone?: unknown };
  const timeZone = typeof settings.timezone === "string" && settings.timezone ? settings.timezone : DEFAULT_TIMEZONE;
  return useCallback((at) => formatWhen(at, { locale, timeZone }), [locale, timeZone]);
}
