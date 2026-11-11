import { formatterFor, ORRN_DEFAULT_PREFS, type Fmt, type ResolvedPrefs } from "@orrn/domain";
import { useT } from "@orrn/i18n";
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

/**
 * The plant's units and formats for every screen (units layer, slice b).
 *
 * `FmtProvider` holds the resolved set the server sent in `auth.me` (`company.units`, no extra request);
 * `useFmt()` gives a `Fmt` built once per preference set and language (`formatterFor` memoises by key).
 * Outside a provider the default set applies, which is what every plant saw before this layer existed.
 */
export const DEFAULT_PLANT_ZONE = "Asia/Kolkata";

type FmtState = { prefs: ResolvedPrefs; timeZone: string };

const FmtContext = createContext<FmtState>({ prefs: ORRN_DEFAULT_PREFS, timeZone: DEFAULT_PLANT_ZONE });

export function FmtProvider({ prefs, timeZone, children }: { prefs?: ResolvedPrefs | null; timeZone?: string | null; children: ReactNode }) {
  const value = useMemo<FmtState>(
    () => ({ prefs: prefs ?? ORRN_DEFAULT_PREFS, timeZone: timeZone || DEFAULT_PLANT_ZONE }),
    [prefs, timeZone],
  );
  return createElement(FmtContext.Provider, { value }, children);
}

/** The formatter for the current plant, person's language and plant time zone. */
export function useFmt(): Fmt {
  const { prefs, timeZone } = useContext(FmtContext);
  const { locale } = useT();
  return useMemo(() => formatterFor(prefs, { locale, timeZone }), [prefs, locale, timeZone]);
}
