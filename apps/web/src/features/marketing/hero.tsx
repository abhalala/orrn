import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { ExtrusionArt } from "./metal-art";

export function Hero() {
  const { t } = useT();
  return (
    <section data-marketing-hero aria-labelledby="hero-title" className="marketing-hero">
      <div className="marketing-container marketing-hero-copy">
        <p className="marketing-eyebrow">{t("marketing.eyebrow")}</p>
        <h1 id="hero-title">{t("marketing.headline")}</h1>
        <div className="marketing-hero-bottom">
          <p className="marketing-intro">{t("marketing.sub")}</p>
          <div className="marketing-actions">
            <Link className="marketing-button" to="/request-access">{t("marketing.requestAccess")}</Link>
            <Link className="marketing-text-link" to="/login">{t("marketing.signIn")}</Link>
          </div>
        </div>
      </div>
      <div className="marketing-metal-scene" aria-hidden="true">
        <ExtrusionArt />
      </div>
    </section>
  );
}
