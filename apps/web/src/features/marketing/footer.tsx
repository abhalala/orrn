import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { PHOTO_CREDITS } from "./media";

/** The four tiles of the orrn mark, one letter knocked out of each, in the mark's own order. */
const BLOCKS = [
  { letter: "o", tone: "red", height: 300 },
  { letter: "r", tone: "amber", height: 222 },
  { letter: "r", tone: "green", height: 264 },
  { letter: "n", tone: "blue", height: 198 },
] as const;
const BLOCK_WIDTH = 247;
const BLOCK_GAP = 4;

/** `credits` lists the photograph credits; only the homepage shows photographs. */
export function MarketingFooter({ credits = false }: { credits?: boolean }) {
  const { t } = useT();
  return (
    <footer className="marketing-footer">
      <Link to="/" className="marketing-blocks" aria-label={t("marketing.homeLabel")}>
        <svg viewBox="0 0 1000 300" aria-hidden="true" focusable="false">
          {BLOCKS.map((block, index) => {
            const x = index * (BLOCK_WIDTH + BLOCK_GAP);
            return (
              // Letters repeat ("r"), so the position is the block's identity.
              <g key={index} data-tone={block.tone}>
                <rect x={x} y={300 - block.height} width={BLOCK_WIDTH} height={block.height} />
                <text x={x + 14} y={286}>
                  {block.letter}
                </text>
              </g>
            );
          })}
        </svg>
      </Link>
      <div className="marketing-footer-grid">
        <p className="marketing-footer-line">{t("marketing.footer")}</p>
        <nav aria-label={t("marketing.footerNav")}>
          <Link to="/guides">{t("marketing.guides")}</Link>
          <Link to="/request-access">{t("marketing.requestAccess")}</Link>
          <Link to="/login">{t("marketing.signIn")}</Link>
          <Link to="/privacy">{t("marketing.privacy")}</Link>
          <Link to="/terms">{t("marketing.terms")}</Link>
        </nav>
      </div>
      {credits ? (
        <p className="marketing-credits">
          {t("marketing.credits")}{" "}
          {PHOTO_CREDITS.map((credit, index) => (
            <span key={credit.page}>
              <a href={credit.page} rel="noreferrer" target="_blank">
                {credit.title}
              </a>
              {`, ${credit.author}, `}
              <a href={credit.licenceUrl} rel="noreferrer license" target="_blank">
                {credit.licence}
              </a>
              {index < PHOTO_CREDITS.length - 1 ? "; " : "."}
            </span>
          ))}
        </p>
      ) : null}
      <p className="marketing-copyright">{t("marketing.copyright", { year: new Date().getFullYear() })}</p>
    </footer>
  );
}
