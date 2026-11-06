import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

/** Brand, the three document links (44 px tall, 24 px apart), the copyright line. */
export function MarketingFooter() {
  const { t } = useT();
  return (
    <footer className="marketing-footer">
      <div className="marketing-wrap">
        <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
          <span aria-hidden="true" className="orrn-mark" />
          <span aria-hidden="true" className="marketing-brand-word">
            {t("common.appName")}
          </span>
        </Link>
        <nav aria-label={t("marketing.footerNav")}>
          <Link to="/guides">{t("marketing.guides")}</Link>
          <Link to="/privacy">{t("marketing.privacy")}</Link>
          <Link to="/terms">{t("marketing.terms")}</Link>
        </nav>
        <p className="marketing-footer-legal">{t("marketing.copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
