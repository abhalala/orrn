import { loadMessages, useT } from "@orrn/i18n";
import { useEffect } from "react";

import { readStoredLocaleOrNull } from "@/shared/lib/locale";
import { useMe } from "@/shared/lib/me";

import { plantLocaleFor } from "./plant-locale-model";

/**
 * Renders nothing. Once `auth.me` has the plant's settings, a device that has never chosen a language
 * moves to the plant's (and keeps it, as a choice it can change in the language toggle). Off for every
 * plant today: nobody sets `settings.locale`, and the Gujarat default is a switch that ships off.
 */
export function PlantLocaleDefault() {
  const { locale, setLocale } = useT();
  const me = useMe();
  const settings = me.data?.company?.settings;
  useEffect(() => {
    if (!settings) return;
    const next = plantLocaleFor(readStoredLocaleOrNull(), settings);
    if (!next || next === locale) return;
    let live = true;
    loadMessages(next).then(
      () => {
        if (live) setLocale(next);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [settings, locale, setLocale]);
  return null;
}
