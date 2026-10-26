import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Link } from "@tanstack/react-router";
import { SearchX } from "lucide-react";

/**
 * `/portal*` for someone who has no party login here (a plant member, a platform admin). The same
 * plain "Not found" a party gets for a record that is not theirs: nothing says what exists. The way out is the
 * portal's own Today (a party has no plant screens).
 */
export function PortalNotFound() {
  const { t } = useT();
  return (
    <main id="main" tabIndex={-1} className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-background px-4 py-16 text-center text-foreground outline-none">
      <div aria-hidden="true" className="flex size-14 items-center justify-center rounded-card bg-surface-sunken">
        <SearchX size={26} aria-hidden="true" />
      </div>
      <div className="max-w-sm space-y-2">
        <h1 className="m-0 font-display text-2xl font-extrabold tracking-[-0.03em]">{t("portal.errors.notFound")}</h1>
        <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("portal.errors.notFoundBody")}</p>
      </div>
      <Button asChild variant="outline">
        <Link to="/portal">{t("portal.errors.backToPlant")}</Link>
      </Button>
    </main>
  );
}
