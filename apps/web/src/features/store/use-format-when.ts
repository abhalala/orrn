import { useT } from "@orrn/i18n";
import { useFmt } from "@/shared/lib/fmt";
import { whenText } from "@/shared/lib/fmt-text";
import { useCallback } from "react";

import { useMe } from "@/shared/lib/me";

import { DEFAULT_TIMEZONE } from "./format";

/** The company's timezone from settings, else the plant default. */
export function useCompanyTimeZone(): string {
  const { data: me } = useMe();
  const settings = (me?.company?.settings ?? {}) as { timezone?: unknown };
  return typeof settings.timezone === "string" && settings.timezone ? settings.timezone : DEFAULT_TIMEZONE;
}

/** `formatWhen` bound to the company timezone and the UI language. */
export function useFormatWhen(): (at: string | number | Date) => string {
  const fmt = useFmt();
  return useCallback((at) => whenText(fmt, at), [fmt]);
}
