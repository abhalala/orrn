import { useT } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";

import { useTheme } from "@/shared/components/theme-provider";

export function MarketingFooter() {
  const { t } = useT();
  const { resolvedTheme, setTheme } = useTheme();
  const choices = [
    { value: "light", label: t("marketing.light") },
    { value: "dark", label: t("marketing.dark") },
  ] as const;

  const moveTheme = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!direction) return;
    event.preventDefault();
    const next = choices[(index + direction + choices.length) % choices.length]!;
    setTheme(next.value);
    document.getElementById(`marketing-theme-${next.value}`)?.focus();
  };

  return (
    <footer className="marketing-footer">
      <div className="marketing-wrap">
        <div className="marketing-footer-row">
          <Link to="/" className="marketing-brand" aria-label={t("marketing.homeLabel")}>
            <span aria-hidden="true" className="orrn-mark" />
            <span aria-hidden="true" className="marketing-brand-word">{t("common.appName")}</span>
          </Link>
          <nav aria-label={t("marketing.footerNav")}>
            <ul>
              <li><Link to="/guides">{t("marketing.guides")}</Link></li>
              <li><Link to="/privacy">{t("marketing.privacy")}</Link></li>
              <li><Link to="/terms">{t("marketing.terms")}</Link></li>
            </ul>
          </nav>
        </div>
        <div className="marketing-footer-bottom">
          <p>{t("marketing.copyright", { year: new Date().getFullYear() })}</p>
          <div className="marketing-theme" role="radiogroup" aria-label={t("marketing.themeLabel")}>
            {choices.map((choice, index) => (
              <button
                key={choice.value}
                id={`marketing-theme-${choice.value}`}
                type="button"
                role="radio"
                aria-checked={resolvedTheme === choice.value}
                tabIndex={resolvedTheme === choice.value ? 0 : -1}
                onClick={() => setTheme(choice.value)}
                onKeyDown={(event) => moveTheme(event, index)}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
