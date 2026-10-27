import { useT } from "@orrn/i18n";
import { breakpoints, useMediaQuery } from "@orrn/ui/hooks/use-media-query";
import { useEffect, useRef, useState } from "react";

import { PROCESS_STAGES, ProcessArt, STAGE_TONE, type ProcessStage } from "./metal-art";

export function Flow() {
  const { t } = useT();
  const root = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<ProcessStage>("scrap");
  const wide = useMediaQuery(breakpoints.desktop);

  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    // Only stage boundaries update React. Scrolling itself never renders or reads layout.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setStage(entry.target.getAttribute("data-flow-step") as ProcessStage);
          }
        }
      },
      { rootMargin: "-42% 0px -48% 0px" },
    );
    root.current.querySelectorAll("[data-flow-step]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  const activeTone = STAGE_TONE[stage];

  function selectStage(step: ProcessStage) {
    setStage(step);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    root.current
      ?.querySelector(`[data-flow-step="${step}"]`)
      ?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }

  return (
    <section
      ref={root}
      id="flow"
      data-active-tone={activeTone}
      className="marketing-container marketing-flow"
      aria-labelledby="flow-title"
    >
      <div className="marketing-section-heading">
        <p className="marketing-eyebrow">{t("marketing.flow.eyebrow")}</p>
        <h2 id="flow-title">{t("marketing.flow.title")}</h2>
        <p>{t("marketing.flow.body")}</p>
      </div>
      <div className="marketing-flow-layout">
        {wide ? (
          <div className="marketing-process-figure">
            <div className="marketing-iso-plate iso" data-tone={activeTone} aria-hidden="true">
              <div className="marketing-plate-header">
                <span className="marketing-plate-fig">{t(`marketing.flow.${stage}.fig`)}</span>
                <span className="marketing-plate-title">{t(`marketing.flow.${stage}.plateTitle`)}</span>
              </div>
              <div className="marketing-plate-stage">
                <ProcessArt stage={stage} />
              </div>
              <div className="marketing-plate-footer">
                <span className="marketing-plate-readout">{t(`marketing.flow.${stage}.readout`)}</span>
              </div>
            </div>
            <div className="marketing-process-track">
              {PROCESS_STAGES.map((step, index) => (
                <button
                  key={step}
                  type="button"
                  data-current={step === stage}
                  data-tone={STAGE_TONE[step]}
                  aria-pressed={step === stage}
                  onClick={() => selectStage(step)}
                >
                  <b className="marketing-track-num">{`0${index + 1}`}</b>
                  {t(`marketing.flow.${step}.name`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <ol role="list" className="marketing-process-list">
          {PROCESS_STAGES.map((step, index) => {
            const stepTone = STAGE_TONE[step];
            return (
              <li
                key={step}
                data-flow-step={step}
                data-current={step === stage}
                aria-current={step === stage ? "step" : undefined}
                data-tone={stepTone}
              >
                {wide ? null : (
                  <div className="marketing-mobile-process" aria-hidden="true">
                    <div className="marketing-iso-plate iso" data-tone={stepTone}>
                      <div className="marketing-plate-header">
                        <span className="marketing-plate-fig">{t(`marketing.flow.${step}.fig`)}</span>
                        <span className="marketing-plate-title">{t(`marketing.flow.${step}.plateTitle`)}</span>
                      </div>
                      <div className="marketing-plate-stage">
                        <ProcessArt stage={step} />
                      </div>
                      <div className="marketing-plate-footer">
                        <span className="marketing-plate-readout">{t(`marketing.flow.${step}.readout`)}</span>
                      </div>
                    </div>
                  </div>
                )}
                <div className="marketing-stage-header">
                  <span className="marketing-stage-index" aria-hidden="true">
                    {`0${index + 1}`}
                  </span>
                  <p className="marketing-stage-name">{t(`marketing.flow.${step}.name`)}</p>
                </div>
                <h3>{t(`marketing.flow.${step}.title`)}</h3>
                <p className="marketing-stage-body">{t(`marketing.flow.${step}.body`)}</p>
                <p className="marketing-stage-record">{t(`marketing.flow.${step}.record`)}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
