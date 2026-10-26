import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import type { BrandTone } from "./metal-art";

const JOBS: readonly { id: "foundry" | "dieRoom" | "planner" | "operator" | "packer" | "gate" | "owner"; tone: BrandTone }[] = [
  { id: "foundry", tone: "red" },
  { id: "dieRoom", tone: "blue" },
  { id: "planner", tone: "amber" },
  { id: "operator", tone: "amber" },
  { id: "packer", tone: "green" },
  { id: "gate", tone: "blue" },
  { id: "owner", tone: "green" },
];

export function Floor() {
  const { t } = useT();
  return (
    <section id="floor" className="marketing-jobs" aria-labelledby="floor-title">
      <div className="marketing-container">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">{t("marketing.floor.eyebrow")}</p>
          <h2 id="floor-title">{t("marketing.floor.title")}</h2>
          <p>{t("marketing.floor.body")}</p>
        </div>
        <div className="marketing-job-list">
          {JOBS.map((job, index) => (
            <article key={job.id} className="marketing-job" data-tone={job.tone}>
              <div className="marketing-job-meta">
                <span className="marketing-job-num" aria-hidden="true">
                  {`0${index + 1}`}
                </span>
                <p className="marketing-job-role">{t(`marketing.floor.${job.id}.role`)}</p>
              </div>
              <div className="marketing-job-content">
                <h3>{t(`marketing.floor.${job.id}.title`)}</h3>
                <p>{t(`marketing.floor.${job.id}.body`)}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="marketing-floor-note">
          <p>{t("marketing.floor.language")}</p>
          <Link to="/guides" className="marketing-text-link">
            {t("marketing.guides")}
          </Link>
        </div>
      </div>
    </section>
  );
}
