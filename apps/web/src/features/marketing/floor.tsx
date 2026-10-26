import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

const JOBS = ["planner", "operator", "packer", "owner"] as const;

export function Floor() {
  const { t } = useT();
  return (
    <section id="floor" className="marketing-jobs" aria-labelledby="floor-title">
      <div className="marketing-container">
        <div className="marketing-section-heading">
          <h2 id="floor-title">{t("marketing.floor.title")}</h2>
          <p>{t("marketing.floor.body")}</p>
        </div>
        <div className="marketing-job-list">
          {JOBS.map((job) => (
            <article key={job} className="marketing-job">
              <p className="marketing-job-role">{t(`marketing.floor.${job}.role`)}</p>
              <div>
                <h3>{t(`marketing.floor.${job}.title`)}</h3>
                <p>{t(`marketing.floor.${job}.body`)}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="marketing-floor-note">
          <p>{t("marketing.floor.language")}</p>
          <Link to="/guides" className="marketing-text-link">{t("marketing.guides")}</Link>
        </div>
      </div>
    </section>
  );
}
