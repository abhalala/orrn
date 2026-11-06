import { useT } from "@orrn/i18n";
import { useEffect } from "react";

/**
 * Tab and screen-reader title for a front-door screen: the screen's own heading, then the app name
 * ("Sign in | orrn"). Without it every one of these pages shows the site-wide title (WCAG 2.4.2).
 * Follows the language toggle because `t` does. `null` leaves the title to the page that owns the heading.
 */
export function usePageTitle(title: string | null) {
  const { t } = useT();
  const full = title ? `${title} | ${t("common.appName")}` : null;
  useEffect(() => {
    if (full) document.title = full;
  }, [full]);
}
