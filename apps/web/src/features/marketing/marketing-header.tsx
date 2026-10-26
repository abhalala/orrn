import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { LanguageToggle } from "@/shell/language-toggle";

export function MarketingHeader() {
  const { t } = useT();
  return (
    <header className="marketing-header">
      <div className="marketing-container marketing-header-inner">
        <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
          <img src="/favicon.svg" alt="" width="36" height="36" />
          <span aria-hidden="true">{t("common.appName")}</span>
        </Link>
        <nav className="marketing-header-links" aria-label={t("marketing.mainNav")}>
          <Link to="/guides">{t("marketing.guides")}</Link>
          <Link to="/login">{t("marketing.signIn")}</Link>
        </nav>
        <LanguageToggle className="marketing-language" />
      </div>
    </header>
  );
}
