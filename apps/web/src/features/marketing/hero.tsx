import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { DemoTag } from "./demo-tag";

/**
 * The bundle page a QR on a label opens, drawn with the fields that page really
 * has (`bundle-facts.tsx`). Its codes come back in the stage list and the scan
 * sheet: bundle 26J4086, die copy 12170-1, cast J14, dispatch DSP-000412.
 * 52.40 kg over 21 pieces at 12 ft is 2.495 kg per 12 ft. The labels stay
 * English because the screen is a picture of the app; the hero's sr-only
 * caption carries the words in the page language.
 */
const FIELDS = [
  { label: "Weight", value: "52.40 kg", code: true },
  { label: "Pieces", value: "21", code: true },
  { label: "Cut length", value: "3658 mm", code: true },
  { label: "kg/12ft", value: "2.495", code: true },
  { label: "Section", value: "12170 Domal", code: false },
  { label: "Die copy", value: "12170-1", code: true },
  { label: "Cast", value: "J14", code: true },
  { label: "Packed", value: "30 Oct", code: false },
] as const;

function BundlePage() {
  return (
    <div className="marketing-shot" data-demo-visual aria-hidden="true" lang="en">
      <DemoTag />
      <div className="marketing-app-top">
        <span className="orrn-mark" />
        <span className="marketing-code">orrn.in/b/26J4086</span>
      </div>
      <div className="marketing-bundle-title">
        <b>
          Bundle <span className="marketing-code">26J4086</span>
        </b>
        <span className="marketing-chip">Dispatched</span>
      </div>
      <p className="marketing-bundle-sub">
        In dispatch <span className="marketing-code">DSP-000412</span>
      </p>
      <dl className="marketing-fields">
        {FIELDS.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>{field.code ? <span className="marketing-code">{field.value}</span> : field.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The first screen: what orrn is, for whom, the two actions, and the record. */
export function Hero() {
  const { t } = useT();
  return (
    <section data-marketing-hero aria-labelledby="hero-title" className="marketing-hero">
      <div className="marketing-wrap">
        <h1 id="hero-title">{t("marketing.headline")}</h1>
        <div className="marketing-grid">
          <div className="marketing-copy">
            <p className="marketing-lead">{t("marketing.sub")}</p>
            <div className="marketing-actions">
              <Link className="marketing-button" to="/request-access">
                {t("marketing.requestAccess")}
              </Link>
              <Link className="marketing-button marketing-button-quiet" to="/login">
                {t("marketing.signIn")}
              </Link>
            </div>
            <p className="marketing-note marketing-small">{t("marketing.note")}</p>
          </div>
          <figure className="marketing-proof">
            <BundlePage />
            <figcaption>
              {/* The sr-only line reads the hidden screen and begins "Demo data."; the visible caption is
                  the one sentence that says how a person reaches this page, so it is read too. */}
              <span className="sr-only">{t("marketing.hero.alt")}</span>
              <span>{t("marketing.hero.caption")}</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
