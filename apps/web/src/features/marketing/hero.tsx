import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { ExtrusionArt, Swatch, type PressPoseMode } from "./metal-art";

const POSES: readonly { id: PressPoseMode; key: "poseCharge" | "posePress" | "poseAge" }[] = [
  { id: "charge", key: "poseCharge" },
  { id: "press", key: "posePress" },
  { id: "age", key: "poseAge" },
];

export function Hero() {
  const { t } = useT();
  const [poseMode, setPoseMode] = useState<PressPoseMode>("press");

  return (
    <section data-marketing-hero aria-labelledby="hero-title" className="marketing-hero">
      <div className="marketing-container marketing-hero-layout">
        <div className="marketing-hero-copy">
          <div className="marketing-eyebrow-row">
            <span aria-hidden="true" className="orrn-mark marketing-logo-sm" />
            <p className="marketing-eyebrow">{t("marketing.eyebrow")}</p>
          </div>
          <h1 id="hero-title">{t("marketing.headline")}</h1>
          <div className="marketing-hero-bottom">
            <p className="marketing-intro">{t("marketing.sub")}</p>
            <div className="marketing-actions">
              <Link className="marketing-button" to="/request-access">
                {t("marketing.requestAccess")}
              </Link>
              <Link className="marketing-text-link" to="/login">
                {t("marketing.signIn")}
              </Link>
            </div>
          </div>
        </div>

        <div className="marketing-metal-scene">
          <div className="marketing-iso-plate iso" data-pose={poseMode}>
            <div className="marketing-plate-header">
              <span className="marketing-plate-fig">{t("marketing.heroPlate.fig")}</span>
              <span className="marketing-plate-title">{t("marketing.heroPlate.title")}</span>
              <div className="marketing-pose-pills" aria-label={t("marketing.heroPlate.title")}>
                {POSES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    data-pose-pill={p.id}
                    data-active={poseMode === p.id}
                    aria-pressed={poseMode === p.id}
                    onClick={() => setPoseMode(p.id)}
                  >
                    {t(`marketing.heroPlate.${p.key}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="marketing-plate-stage" aria-hidden="true">
              <ExtrusionArt poseMode={poseMode} />
            </div>

            <div className="marketing-plate-footer">
              <div className="marketing-plate-keys">
                <span className="iso-key">
                  <Swatch mark="lit" />
                  {t("marketing.heroPlate.keyRam")}
                </span>
                <span className="iso-key">
                  <Swatch mark="raised" />
                  {t("marketing.heroPlate.keyPress")}
                </span>
                <span className="iso-key">
                  <Swatch mark="flat" />
                  {t("marketing.heroPlate.keyOven")}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="marketing-container marketing-audit-record">
        <div className="marketing-audit-lead" data-tone="amber">
          <span className="marketing-proof-value">{t("marketing.proof.phantomValue")}</span>
          <p className="marketing-proof-label">{t("marketing.proof.phantomLabel")}</p>
        </div>
        <dl className="marketing-audit-facts">
          <div data-tone="red">
            <dt>{t("marketing.proof.chainValue")}</dt>
            <dd>{t("marketing.proof.chainLabel")}</dd>
          </div>
          <div data-tone="green">
            <dt>{t("marketing.proof.traceValue")}</dt>
            <dd>{t("marketing.proof.traceLabel")}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
