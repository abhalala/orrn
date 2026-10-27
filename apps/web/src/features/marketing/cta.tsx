import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

export function Cta() {
  const { t } = useT();
  return (
    <section data-marketing-cta aria-labelledby="cta-title" className="marketing-container marketing-cta">
      <div className="marketing-cta-mark" aria-hidden="true">
        <span className="orrn-mark marketing-logo-lg" />
        <span className="marketing-cta-line" />
      </div>
      <h2 id="cta-title">{t("marketing.cta.title")}</h2>
      <p>{t("marketing.cta.body")}</p>
      <div className="marketing-actions">
        <Link className="marketing-button" to="/request-access">
          {t("marketing.requestAccess")}
        </Link>
        <Link className="marketing-text-link" to="/login">
          {t("marketing.signIn")}
        </Link>
      </div>
    </section>
  );
}
