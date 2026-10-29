import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

import { BarcodeStrip, BundleLabel } from "./bundle-label";
import { PHOTOS } from "./media";
import { StagePhoto } from "./stage-photo";

/**
 * The first screen is the label orrn prints for a bundle: a paper card with
 * the barcode strip across its top, the page title, and the sample label
 * fields. On a phone the furnace photograph comes first and the card
 * overlaps its foot; on wider screens the photograph is the sticky frame
 * beside it (see `Story`).
 */
export function Hero({ wide }: { wide: boolean }) {
  const { t } = useT();
  return (
    <section data-marketing-hero data-frame="hero" aria-labelledby="hero-title" className="marketing-hero">
      {wide ? null : (
        <StagePhoto
          className="marketing-hero-photo"
          photo={PHOTOS.furnace}
          sizes="100vw"
          alt={t("marketing.chain.heroAlt")}
          caption={t("marketing.chain.heroCaption")}
          priority
        />
      )}
      <div className="marketing-card">
        <BarcodeStrip className="marketing-barcode marketing-card-bars" />
        <p className="marketing-card-mark" aria-hidden="true">
          <span className="orrn-mark" />
          <span>{t("common.appName")}</span>
        </p>
        <h1 id="hero-title" className="marketing-display">
          <span className="marketing-line">
            <span style={{ "--i": 0 } as CSSProperties}>{t("marketing.headline1")}</span>
          </span>{" "}
          <span className="marketing-line">
            <span style={{ "--i": 1 } as CSSProperties}>{t("marketing.headline2")}</span>
          </span>
        </h1>
        <p className="marketing-card-sub">{t("marketing.sub")}</p>
        <div className="marketing-actions">
          <Link className="marketing-button" data-tone="ink" to="/request-access">
            {t("marketing.requestAccess")}
          </Link>
          <Link className="marketing-text-link" to="/login">
            {t("marketing.signIn")}
          </Link>
        </div>
        <BundleLabel className="marketing-card-label" />
      </div>
    </section>
  );
}

