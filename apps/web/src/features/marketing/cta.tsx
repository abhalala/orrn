import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

/** The close: the ask in the left rail, what happens next and the two actions on the right. */
export function Cta() {
  const { t } = useT();
  return (
    <section data-marketing-cta aria-labelledby="close-title" className="marketing-close">
      <div className="marketing-wrap marketing-grid">
        <div className="marketing-copy">
          <h2 id="close-title">{t("marketing.close.title")}</h2>
        </div>
        <div className="marketing-proof">
          <p className="marketing-lead">{t("marketing.close.body")}</p>
          <div className="marketing-actions">
            <Link className="marketing-button" to="/request-access">
              {t("marketing.requestAccess")}
            </Link>
            <Link className="marketing-button marketing-button-quiet" to="/login">
              {t("marketing.signIn")}
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
