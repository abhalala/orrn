import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

export function MarketingFooter() {
  const { t } = useT();
  return (
    <footer className="marketing-container marketing-footer">
      <div className="marketing-footer-top">
        <div>
          <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
            <img src="/favicon.svg" alt="" width="32" height="32" />
            <span aria-hidden="true">{t("common.appName")}</span>
          </Link>
          <p>{t("marketing.footer")}</p>
        </div>
        <nav aria-label={t("marketing.footerNav")}>
          <Link to="/guides">{t("marketing.guides")}</Link>
          <Link to="/request-access">{t("marketing.requestAccess")}</Link>
          <Link to="/login">{t("marketing.signIn")}</Link>
        </nav>
      </div>
      <p className="marketing-copyright">{t("marketing.copyright", { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
