/**
 * Closing call to action: an ink hero block (dark in both themes) with the
 * same two actions as the hero, named the same way.
 */
import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { cn } from "@orrn/ui/lib/utils";
import { Link } from "@tanstack/react-router";

import { displaySetting } from "./display-type";

export function Cta() {
  const { t, locale } = useT();
  return (
    <section data-marketing-cta aria-labelledby="cta-title" className="orrn-section pb-20 pt-8 md:pb-28">
      <div className="orrn-block orrn-block-neutral orrn-block-hero orrn-ink-panel px-6 py-14 text-center md:px-12 md:py-20">
        <h2
          id="cta-title"
          className={cn("orrn-display-2 m-0 mx-auto max-w-[16ch] text-balance text-foreground", displaySetting(locale))}
        >
          {t("marketing.cta.title")}
        </h2>
        <p className="m-0 mx-auto mt-5 max-w-[32rem] text-pretty text-lg leading-8 text-muted-foreground">
          {t("marketing.cta.body")}
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg">
            <Link to="/request-access">{t("marketing.requestAccess")}</Link>
          </Button>
          <Button asChild size="lg" variant="secondary">
            <Link to="/login">{t("marketing.signIn")}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
