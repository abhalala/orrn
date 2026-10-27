import { createI18n, useT } from "@orrn/i18n";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import "@/features/marketing/marketing.css";
import { Cta } from "@/features/marketing/cta";
import { Floor } from "@/features/marketing/floor";
import { Flow } from "@/features/marketing/flow";
import { MarketingFooter } from "@/features/marketing/footer";
import { Hero } from "@/features/marketing/hero";
import { MarketingHeader } from "@/features/marketing/marketing-header";
import { Office } from "@/features/marketing/office";
import { loadMe } from "@/shared/lib/guards";
import { homeTarget } from "@/shared/lib/home";
import { readStoredLocale } from "@/shared/lib/locale";
import type { Me } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_public/")({
  head: () => {
    const { t } = createI18n(readStoredLocale());
    return {
      meta: [{ title: t("marketing.metaTitle") }, { name: "description", content: t("marketing.sub") }],
    };
  },
  component: MarketingPage,
});

/** The background session check fills `auth.me`; this sends a signed-in person home when it lands. */
function useLateSessionRedirect() {
  const navigate = useNavigate();
  const { data } = useQuery({ ...trpc.auth.me.queryOptions(), enabled: false });
  const me = data as Me | null | undefined;
  useEffect(() => {
    if (me?.user) void navigate({ to: homeTarget(me), replace: true });
  }, [me, navigate]);
}

/**
 * `head()` runs once per route match, so the language toggle would leave the
 * tab title and description in the old language (and a screen reader reading
 * an English title in a Hindi voice). Keep them in step with the page.
 */
function useLocalizedHead() {
  const { t } = useT();
  const title = t("marketing.metaTitle");
  const description = t("marketing.sub");
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", description);
  }, [title, description]);
}

function MarketingPage() {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  useLateSessionRedirect();
  useLocalizedHead();

  useEffect(() => {
    void loadMe(queryClient).catch(() => undefined);
  }, [queryClient]);
  return (
    // `data-orrn-marketing` marks this route's chunk for the `/` JS budget (scripts/check-route-budget.ts).
    <div data-orrn-marketing data-locale={locale} className="marketing-page orrn-ink-panel min-h-[100dvh] w-full">
      <a
        href="#main"
        className="fixed left-3 top-3 z-50 -translate-y-24 rounded-full bg-primary px-5 py-3 text-[15px] font-semibold text-primary-foreground no-underline focus-visible:translate-y-0"
      >
        {t("nav.skipToContent")}
      </a>
      <MarketingHeader />
      <main id="main" tabIndex={-1}>
        <Hero />
        <Flow />
        <Floor />
        <Office />
        <Cta />
      </main>
      <MarketingFooter />
    </div>
  );
}
