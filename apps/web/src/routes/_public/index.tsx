import { createI18n, useT } from "@orrn/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import "@/features/marketing/marketing.css";
import { MarketingFooter } from "@/features/marketing/footer";
import { Hero } from "@/features/marketing/hero";
import { Benefits, Close, Faq, Flow, Keep, Proof, Record, Tagline } from "@/features/marketing/home-sections";
import { MarketingHeader } from "@/features/marketing/marketing-header";
import { loadMe } from "@/shared/lib/guards";
import { homeTarget } from "@/shared/lib/home";
import { readStoredLocale } from "@/shared/lib/locale";
import type { Me } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

const FAQ_IDS = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9", "q10"] as const;

export const Route = createFileRoute("/_public/")({
  head: () => {
    const { t } = createI18n(readStoredLocale());
    const title = t("marketing.metaTitle");
    const description = t("marketing.metaDescription");
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "orrn" },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:url", content: "https://orrn.in/" },
        { property: "og:locale", content: "en_IN" },
        { property: "og:image", content: "https://orrn.in/og.png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        { name: "twitter:image", content: "https://orrn.in/og.png" },
      ],
    };
  },
  component: MarketingPage,
});

function useLateSessionRedirect() {
  const navigate = useNavigate();
  const { data } = useQuery({ ...trpc.auth.me.queryOptions(), enabled: false });
  const me = data as Me | null | undefined;
  useEffect(() => {
    if (me?.user) void navigate({ to: homeTarget(me), replace: true });
  }, [me, navigate]);
}

function useLocalizedHead() {
  const { t, locale } = useT();
  const title = t("marketing.metaTitle");
  const description = t("marketing.metaDescription");
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", title);
    document.querySelector('meta[property="og:description"]')?.setAttribute("content", description);
    document.querySelector('meta[property="og:locale"]')?.setAttribute("content", locale === "hi" ? "hi_IN" : "en_IN");
    const script = document.getElementById("marketing-faq-jsonld") ?? document.createElement("script");
    script.id = "marketing-faq-jsonld";
    script.setAttribute("type", "application/ld+json");
    script.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ_IDS.map((id) => ({
        "@type": "Question",
        name: t(`marketing.faq.${id}.q`),
        acceptedAnswer: { "@type": "Answer", text: t(`marketing.faq.${id}.a`) },
      })),
    });
    if (!script.parentNode) document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [title, description, locale, t]);
}

function useMarketingMotion() {
  useEffect(() => {
    const page = document.querySelector(".marketing-page");
    if (!page) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const still = reduced || navigator.webdriver || typeof IntersectionObserver === "undefined";
    const reveals = [...document.querySelectorAll("[data-reveal]")];
    const words = [...document.querySelectorAll("[data-tagline-word]")];
    if (still) {
      reveals.forEach((element) => element.classList.add("marketing-revealed"));
      words.forEach((element) => element.classList.add("marketing-word-active"));
      return;
    }
    page.setAttribute("data-motion", "yes");
    const revealObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("marketing-revealed");
          revealObserver.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    reveals.forEach((element) => revealObserver.observe(element));
    const wordObserver = new IntersectionObserver(
      (entries) => {
        const active = entries.filter((entry) => entry.isIntersecting).sort((a, b) => words.indexOf(a.target) - words.indexOf(b.target));
        active.forEach((entry, index) => {
          const element = entry.target as HTMLElement;
          element.style.transitionDelay = `${index * 70}ms`;
          element.classList.add("marketing-word-active");
          wordObserver.unobserve(element);
        });
      },
      { rootMargin: "0px 0px -40% 0px", threshold: 1 },
    );
    words.forEach((word) => wordObserver.observe(word));
    return () => {
      revealObserver.disconnect();
      wordObserver.disconnect();
      page.removeAttribute("data-motion");
    };
  }, []);
}

function MarketingPage() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  useLateSessionRedirect();
  useLocalizedHead();
  useMarketingMotion();

  useEffect(() => {
    void loadMe(queryClient).catch(() => undefined);
  }, [queryClient]);
  return (
    <div data-orrn-marketing data-locale={locale} className="marketing-page min-h-[100dvh] w-full">
      <a
        href="#main"
        className="fixed left-3 top-3 z-[60] -translate-y-24 rounded-full bg-primary px-5 py-3 text-[15px] font-semibold text-primary-foreground no-underline focus-visible:translate-y-0"
      >
        {t("nav.skipToContent")}
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Record />
        <Benefits />
        <Tagline />
        <Flow />
        <Proof />
        <Faq />
        <Keep />
        <Close />
      </main>
      <MarketingFooter />
    </div>
  );
}
