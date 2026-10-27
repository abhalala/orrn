import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

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
  const [activeId, setActiveId] = useState<(typeof JOBS)[number]["id"]>("foundry");
  const active = JOBS.find((job) => job.id === activeId) ?? JOBS[0]!;

  return (
    <section id="floor" className="marketing-jobs" aria-labelledby="floor-title">
      <div className="marketing-container">
        <div className="marketing-section-heading">
          <p className="marketing-eyebrow">{t("marketing.floor.eyebrow")}</p>
          <h2 id="floor-title">{t("marketing.floor.title")}</h2>
          <p>{t("marketing.floor.body")}</p>
        </div>
        <div className="marketing-role-ledger">
          <div className="marketing-role-tabs" aria-label={t("marketing.floor.eyebrow")}>
            {JOBS.map((job, index) => (
              <button
                key={job.id}
                type="button"
                data-tone={job.tone}
                aria-pressed={activeId === job.id}
                aria-controls="marketing-role-panel"
                onClick={() => setActiveId(job.id)}
              >
                <span aria-hidden="true">{`0${index + 1}`}</span>
                {t(`marketing.floor.${job.id}.role`)}
              </button>
            ))}
          </div>
          <article id="marketing-role-panel" key={active.id} className="marketing-role-panel" data-tone={active.tone}>
            <h3>{t(`marketing.floor.${active.id}.title`)}</h3>
            <p>{t(`marketing.floor.${active.id}.body`)}</p>
          </article>
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
