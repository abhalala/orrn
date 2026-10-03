import { createI18n, useT } from "@orrn/i18n";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { Cta } from "@/features/marketing/cta";
import { Floor } from "@/features/marketing/floor";
import { Flow } from "@/features/marketing/flow";
import { MarketingFooter } from "@/features/marketing/footer";
import { Hero } from "@/features/marketing/hero";
import { MarketingHeader } from "@/features/marketing/marketing-header";
import { Office } from "@/features/marketing/office";
import { Trust } from "@/features/marketing/trust";
import { loadMe } from "@/shared/lib/guards";
import { homeTarget } from "@/shared/lib/home";
import { readStoredLocale } from "@/shared/lib/locale";

export const Route = createFileRoute("/_public/")({
  /**
   * Signed-in people skip the marketing page: redirect in beforeLoad so they
   * never see a flash of it. An unreachable API counts as signed out.
   */
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (me?.user) {
      throw redirect({ to: homeTarget(me) });
    }
  },
  head: () => {
    const { t } = createI18n(readStoredLocale());
    return {
      meta: [{ title: t("marketing.metaTitle") }, { name: "description", content: t("marketing.sub") }],
    };
  },
  component: MarketingPage,
});

function MarketingPage() {
  const { t } = useT();
  return (
    // `data-orrn-marketing` marks this route's chunk for the `/` JS budget (scripts/check-route-budget.ts).
    <div data-orrn-marketing className="min-h-[100dvh] w-full bg-background text-foreground">
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
        <Trust />
        <Cta />
      </main>
      <MarketingFooter />
    </div>
  );
}
