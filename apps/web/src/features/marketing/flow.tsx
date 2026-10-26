import { useT } from "@orrn/i18n";
import { useEffect, useRef, useState } from "react";

import { PROCESS_STAGES, ProcessArt, type ProcessStage } from "./metal-art";

export function Flow() {
  const { t } = useT();
  const root = useRef<HTMLElement>(null);
  const [stage, setStage] = useState<ProcessStage>("scrap");

  useEffect(() => {
    if (!root.current || typeof IntersectionObserver === "undefined") return;
    // Only stage boundaries update React. Scrolling itself never renders or reads layout.
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) setStage(entry.target.getAttribute("data-flow-step") as ProcessStage);
      }
    }, { rootMargin: "-25% 0px -40% 0px" });
    root.current.querySelectorAll("[data-flow-step]").forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={root} id="flow" className="marketing-container marketing-flow" aria-labelledby="flow-title">
      <div className="marketing-section-heading">
        <h2 id="flow-title">{t("marketing.flow.title")}</h2>
        <p>{t("marketing.flow.body")}</p>
      </div>
      <div className="marketing-flow-layout">
        <div className="marketing-process-figure" aria-hidden="true">
          <ProcessArt stage={stage} />
          <div className="marketing-process-track">
            {PROCESS_STAGES.map((step) => (
              <span key={step} data-current={step === stage}>{t(`marketing.flow.${step}.name`)}</span>
            ))}
          </div>
        </div>
        <ol role="list" className="marketing-process-list">
          {PROCESS_STAGES.map((step) => (
            <li key={step} data-flow-step={step} data-current={step === stage}>
              <div className="marketing-mobile-process" aria-hidden="true"><ProcessArt stage={step} /></div>
              <p className="marketing-stage-name">{t(`marketing.flow.${step}.name`)}</p>
              <h3>{t(`marketing.flow.${step}.title`)}</h3>
              <p className="marketing-stage-body">{t(`marketing.flow.${step}.body`)}</p>
              <p className="marketing-stage-record">{t(`marketing.flow.${step}.record`)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
