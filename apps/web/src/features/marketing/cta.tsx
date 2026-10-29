import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { PHOTOS, srcSet } from "./media";

/** The close: one row of the board, the amber action tile between a yard photograph and a flat tile. */
export function Cta() {
  const { t } = useT();
  const yard = PHOTOS.yard;
  return (
    <section data-marketing-cta aria-labelledby="cta-title" className="marketing-cta">
      <div className="marketing-cta-flank" style={{ backgroundColor: yard.ground }}>
        <img
          src={yard.lg}
          srcSet={srcSet(yard)}
          sizes="20vw"
          width={yard.width}
          height={yard.height}
          alt=""
          loading="lazy"
          decoding="async"
          style={{ objectPosition: yard.focus }}
        />
      </div>
      <div className="marketing-cta-tile" data-reveal>
        <h2 id="cta-title" className="marketing-heading">
          {t("marketing.cta.title")}
        </h2>
        <p>{t("marketing.cta.body")}</p>
        <div className="marketing-actions">
          <Link className="marketing-button" data-tone="ink" to="/request-access">
            {t("marketing.requestAccess")}
          </Link>
          <Link className="marketing-text-link" to="/login">
            {t("marketing.signIn")}
          </Link>
        </div>
      </div>
      <div className="marketing-cta-flank" data-fill="surface" aria-hidden="true" />
    </section>
  );
}
