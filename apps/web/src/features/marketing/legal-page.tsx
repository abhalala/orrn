import { useT, type MessageKey } from "@orrn/i18n";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { MarketingFooter } from "./footer";
import { MarketingHeader } from "./marketing-header";

type LegalSection = { id: string; title: MessageKey; body: MessageKey };

const SECTIONS: Record<"privacy" | "terms", readonly LegalSection[]> = {
  privacy: [
    { id: "information", title: "legal.privacy.sections.information.title", body: "legal.privacy.sections.information.body" },
    { id: "operations", title: "legal.privacy.sections.operations.title", body: "legal.privacy.sections.operations.body" },
    { id: "use", title: "legal.privacy.sections.use.title", body: "legal.privacy.sections.use.body" },
    { id: "hosting", title: "legal.privacy.sections.hosting.title", body: "legal.privacy.sections.hosting.body" },
    { id: "devices", title: "legal.privacy.sections.devices.title", body: "legal.privacy.sections.devices.body" },
    { id: "sharing", title: "legal.privacy.sections.sharing.title", body: "legal.privacy.sections.sharing.body" },
    { id: "retention", title: "legal.privacy.sections.retention.title", body: "legal.privacy.sections.retention.body" },
    { id: "choices", title: "legal.privacy.sections.choices.title", body: "legal.privacy.sections.choices.body" },
  ],
  terms: [
    { id: "agreement", title: "legal.terms.sections.agreement.title", body: "legal.terms.sections.agreement.body" },
    { id: "accounts", title: "legal.terms.sections.accounts.title", body: "legal.terms.sections.accounts.body" },
    { id: "plantData", title: "legal.terms.sections.plantData.title", body: "legal.terms.sections.plantData.body" },
    { id: "use", title: "legal.terms.sections.use.title", body: "legal.terms.sections.use.body" },
    { id: "service", title: "legal.terms.sections.service.title", body: "legal.terms.sections.service.body" },
    { id: "commercial", title: "legal.terms.sections.commercial.title", body: "legal.terms.sections.commercial.body" },
    { id: "thirdParties", title: "legal.terms.sections.thirdParties.title", body: "legal.terms.sections.thirdParties.body" },
    { id: "availability", title: "legal.terms.sections.availability.title", body: "legal.terms.sections.availability.body" },
  ],
};

export type LegalPageKind = keyof typeof SECTIONS;

export function LegalPage({ page }: { page: LegalPageKind }) {
  const { t, locale } = useT();
  const title = t(`legal.${page}.metaTitle`);
  const description = t(`legal.${page}.intro`);
  const [activeSection, setActiveSection] = useState("");
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);

  useEffect(() => {
    const sections = document.querySelectorAll("[data-orrn-legal] .marketing-legal-section");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) if (entry.isIntersecting) setActiveSection(entry.target.id);
      },
      { rootMargin: "-20% 0px -65% 0px" },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [page]);

  return (
    <div data-orrn-legal={page} data-locale={locale} className="marketing-page orrn-ink-panel min-h-[100dvh] w-full">
      <a
        href="#main"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-full bg-primary px-5 py-3 text-[15px] font-semibold text-primary-foreground no-underline focus-visible:translate-y-0"
      >
        {t("nav.skipToContent")}
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1} className="marketing-legal-main">
        <div className="marketing-container">
          <header className="marketing-legal-header">
            <p className="marketing-legal-updated">{t(`legal.${page}.updated`)}</p>
            <h1>{t(`legal.${page}.title`)}</h1>
            <p className="marketing-legal-intro">{description}</p>
          </header>
          <div className="marketing-legal-layout">
            <nav className="marketing-legal-nav" aria-label={t(`legal.${page}.nav`)}>
              {SECTIONS[page].map(({ id, title }, index) => (
                <a key={id} href={`#${id}`} aria-current={activeSection === id ? "location" : undefined}>
                  <span aria-hidden="true">{`0${index + 1}`}</span>
                  {t(title)}
                </a>
              ))}
            </nav>
            <article>
              {SECTIONS[page].map(({ id, title, body }, index) => (
                <section key={id} id={id} className="marketing-legal-section" aria-labelledby={`${id}-title`}>
                  <h2 id={`${id}-title`}>
                    <span aria-hidden="true">{`0${index + 1}`}</span>
                    {t(title)}
                  </h2>
                  <p>{t(body)}</p>
                </section>
              ))}
              <aside className="marketing-legal-contact" aria-labelledby="legal-contact-title">
                <h2 id="legal-contact-title">{t("legal.contact.title")}</h2>
                <p>{t("legal.contact.body")}</p>
                <Link className="marketing-button" to="/request-access">
                  {t("legal.contact.action")}
                </Link>
              </aside>
            </article>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
