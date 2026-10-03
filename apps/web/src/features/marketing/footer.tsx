import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

/** Quiet footer: wordmark and line, the two front-door links, copyright. */
export function MarketingFooter() {
  const { t } = useT();
  const link =
    "inline-flex min-h-11 items-center rounded-full px-3 text-[15px] font-semibold text-foreground no-underline hover:bg-accent";
  return (
    <footer className="orrn-section pb-10">
      <div className="flex flex-col gap-6 border-t border-border pt-8 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="orrn-mark size-7" />
          <p className="m-0 min-w-0 text-[14px] text-muted-foreground">
            <span className="font-display text-[17px] font-extrabold tracking-[-0.03em] text-foreground">
              {t("common.appName")}
            </span>
            <span className="ml-2">{t("marketing.footer")}</span>
          </p>
        </div>
        <nav aria-label={t("marketing.footerNav")} className="-ml-3 flex flex-wrap items-center gap-1 md:ml-0">
          <Link to="/request-access" className={link}>
            {t("marketing.requestAccess")}
          </Link>
          <Link to="/login" className={link}>
            {t("marketing.signIn")}
          </Link>
        </nav>
      </div>
      <p className="m-0 mt-6 text-[13px] text-muted-foreground">
        {t("marketing.copyright", { year: new Date().getFullYear() })}
      </p>
    </footer>
  );
}
