import { useT } from "@orrn/i18n";

/**
 * The seven stages with one example code each, in Geist Mono. The codes are
 * format examples, not demo plant codes, and four of them come back elsewhere
 * on the page: 26J4086, 12170-1 and J14 in the hero's bundle page, 26J4086 and
 * DSP-000412 in the scan sheet, PR-418 in the numbers card. Change one here
 * and change it there too.
 */
const STAGES = [
  { step: "scrap", code: "LOT-118" },
  { step: "cast", code: "J14" },
  { step: "die", code: "12170-1" },
  { step: "press", code: "PR-418" },
  { step: "age", code: "AG-96" },
  { step: "pack", code: "26J4086" },
  { step: "dispatch", code: "DSP-000412" },
] as const;

/** How it works (#flow): each stage writes the code a later stage reads. */
export function Stages() {
  const { t } = useT();
  return (
    <section id="flow" aria-labelledby="flow-title" className="marketing-section">
      <div className="marketing-wrap marketing-grid">
        <div className="marketing-copy">
          <h2 id="flow-title">{t("marketing.flow.title")}</h2>
          <p>{t("marketing.flow.body")}</p>
        </div>
        <div className="marketing-proof">
          {/* Column heads from 640 px. Each row already reads as name, code, sentence, so they are decoration. */}
          <div className="marketing-stages-head" aria-hidden="true">
            <span>{t("marketing.flow.colStage")}</span>
            <span>{t("marketing.flow.colCode")}</span>
            <span>{t("marketing.flow.colWhat")}</span>
          </div>
          <ol className="marketing-stages">
            {STAGES.map(({ step, code }) => (
              <li key={step} data-flow-step={step}>
                <span className="marketing-stage-name">{t(`marketing.flow.${step}.name`)}</span>
                <span className="marketing-code">{code}</span>
                <span className="marketing-stage-what">{t(`marketing.flow.${step}.body`)}</span>
              </li>
            ))}
          </ol>
          <p className="marketing-after marketing-small">{t("marketing.flow.after")}</p>
        </div>
      </div>
    </section>
  );
}
