import { formatterFor, ORRN_DEFAULT_PREFS, type Fmt, type ResolvedPrefs } from "@orrn/domain";
import { I18nVarsProvider, useT } from "@orrn/i18n";
import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";

import { paperFormatter } from "./paper-fmt";
import { isValidZone } from "./plant-calendar";

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
    // A zone `Intl` does not know would turn every date into a dash: the plant's default clock stands in.
    () => ({ prefs: prefs ?? ORRN_DEFAULT_PREFS, timeZone: timeZone && isValidZone(timeZone) ? timeZone : DEFAULT_PLANT_ZONE }),
    [prefs, timeZone],
  );
  // The plant's unit words reach every t() call below: {massUnit}, {sectionUnit}, {lengthUnit}.
  const words = useMemo(() => {
    const f = formatterFor(value.prefs, { locale: "en", timeZone: value.timeZone });
    const length = f.unitOf("length");
    return { massUnit: f.unitOf("mass").symbol, sectionUnit: f.unitOf("linear_mass").symbol, lengthUnit: length.composite ? "ft in" : length.symbol };
  }, [value]);
  return createElement(FmtContext.Provider, { value }, createElement(I18nVarsProvider, { vars: words, children }));
}

/**
 * The formatter for a paper (the packing list, the pack stickers, the printed die card, the test certificates): today's
 * units and words, date style and 24 hour clock whatever the plant chose for its screens, in the person's language and
 * the plant's zone. A plant that wrote lengths in feet and inches keeps them. The paper keeps its own style until it has its
 * own setting (design: papers follow the plant's setting, then the customer's). Pair it with `paperT` for the words, and
 * never call `useFmt()` in a paper (`paper-guard.test.ts` lists the papers).
 */
export function usePaperFmt(): Fmt {
  const { timeZone, prefs } = useContext(FmtContext);
  const { locale } = useT();
  const inch = prefs.units.length === "ft_in";
  return useMemo(() => paperFormatter(locale, timeZone, { inch }), [locale, timeZone, inch]);
}

/** The formatter for the current plant, person's language and plant time zone. */
export function useFmt(): Fmt {
  const { prefs, timeZone } = useContext(FmtContext);
  const { locale } = useT();
  return useMemo(() => formatterFor(prefs, { locale, timeZone }), [prefs, locale, timeZone]);
}
