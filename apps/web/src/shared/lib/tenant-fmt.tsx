import { createElement, type ReactNode } from "react";

import { FmtProvider } from "./fmt";
import { useMe } from "./me";

/** The signed-in plant's set, from `auth.me`. Mounted once in the tenant frame. */
export function TenantFmtProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const settings = me?.company?.settings as { timezone?: unknown } | undefined;
  const zone = typeof settings?.timezone === "string" && settings.timezone ? settings.timezone : null;
  return createElement(FmtProvider, { prefs: me?.company?.units, timeZone: zone, children });
}
