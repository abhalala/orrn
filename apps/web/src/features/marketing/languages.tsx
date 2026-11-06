import { useT } from "@orrn/i18n";

import { StatusChip } from "./status-chip";

/**
 * One refusal in three languages, word for word from the app's dictionaries:
 * the scanner's "rejected" result and its "wrongCustomerOther" reason.
 * The strings live under `marketing.floor.*` rather than being imported from
 * the locale files, because a locale import on `/` breaks the route budget;
 * packages/i18n marketing-floor.test.ts keeps the copies equal to the source.
 * This figure is not demo data: it is readable, and each sentence carries its
 * own `lang`.
 */
const ROWS = [
  { lang: "en", name: "langEn", refused: "refusedEn", reason: "reasonEn" },
  { lang: "hi", name: "langHi", refused: "refusedHi", reason: "reasonHi" },
  { lang: "gu", name: "langGu", refused: "refusedGu", reason: "reasonGu" },
] as const;

/** For your team (#floor): roles and languages, shown with real strings. */
export function Languages() {
  const { t } = useT();
  return (
    <section id="floor" aria-labelledby="floor-title" className="marketing-section">
      <div className="marketing-wrap marketing-grid">
        <div className="marketing-copy">
          <h2 id="floor-title">{t("marketing.floor.title")}</h2>
          <p>{t("marketing.floor.body1")}</p>
          <p>{t("marketing.floor.body2")}</p>
        </div>
        <figure className="marketing-proof">
          <ul className="marketing-trio">
            {ROWS.map((row) => (
              <li key={row.lang}>
                {/* The language names are written in the page language (English, Hindi, Gujarati; अंग्रेज़ी, हिंदी, गुजराती), so they need no lang of their own. */}
                <span className="marketing-trio-lang">{t(`marketing.floor.${row.name}`)}</span>
                <span className="marketing-trio-say" lang={row.lang}>
                  <StatusChip state="no">{t(`marketing.floor.${row.refused}`)}</StatusChip>
                  {t(`marketing.floor.${row.reason}`)}
                </span>
              </li>
            ))}
          </ul>
          <figcaption>{t("marketing.floor.caption")}</figcaption>
        </figure>
      </div>
    </section>
  );
}
