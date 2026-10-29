import { useT } from "@orrn/i18n";
import { useId, useState } from "react";

/** Share of listed bundles already gone in orrn's first plant yard audit (marketing copy states the source). */
const AUDIT_GONE_SHARE = 0.62;
const count = new Intl.NumberFormat("en-IN");

/**
 * The visitor sets the size of their own stock list and reads how many of
 * those bundles the first yard audit's rate says may already have left.
 */
export function Audit() {
  const { t } = useT();
  const inputId = useId();
  const [listed, setListed] = useState(1200);
  const gone = Math.round(listed * AUDIT_GONE_SHARE);

  return (
    <section id="audit" className="marketing-audit" aria-labelledby="audit-title">
      <div className="marketing-audit-ask" data-reveal>
        <h2 id="audit-title" className="marketing-heading">
          {t("marketing.audit.title")}
        </h2>
        <div data-ui className="marketing-slider">
          <label htmlFor={inputId}>
            <span>{t("marketing.audit.control")}</span>
            <output htmlFor={inputId}>{count.format(listed)}</output>
          </label>
          <input
            id={inputId}
            type="range"
            min={100}
            max={5000}
            step={50}
            value={listed}
            onChange={(event) => setListed(Number(event.currentTarget.value))}
          />
        </div>
      </div>
      <div className="marketing-audit-result" data-reveal>
        <p className="marketing-figure">
          <span>{count.format(gone)}</span> <small>{t("marketing.audit.unit")}</small>
        </p>
        <p className="marketing-audit-working">{t("marketing.audit.working")}</p>
      </div>
    </section>
  );
}
