import { useT } from "@orrn/i18n";

/**
 * First stop for keyboard users: hidden until focused, then a pill at the top
 * left. Moves focus into `<main>` (not just the scroll position), so the next
 * Tab continues from the page content.
 */
export function SkipLink() {
  const { t } = useT();
  return (
    <a
      href="#main"
      onClick={(e) => {
        const main = document.getElementById("main");
        if (!main) return;
        e.preventDefault();
        main.focus({ preventScroll: false });
        main.scrollIntoView({ block: "start" });
      }}
      className="sr-only rounded-full bg-primary px-5 py-3 text-[15px] font-semibold text-primary-foreground no-underline shadow-button focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60]"
    >
      {t("nav.skipToContent")}
    </a>
  );
}
