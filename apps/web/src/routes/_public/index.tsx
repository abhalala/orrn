import { createFileRoute, redirect } from "@tanstack/react-router";

import { MarketingHeader } from "@/features/marketing/marketing-header";
import { CtaSection } from "@/features/marketing/sections/cta";
import { HeroSection } from "@/features/marketing/sections/hero";
import { ModulesSection } from "@/features/marketing/sections/modules";
import { TenantFirstSection } from "@/features/marketing/sections/tenant-first";
import { WorkflowSection } from "@/features/marketing/sections/workflow";
import { loadMe } from "@/shared/lib/guards";
import { homeTarget } from "@/shared/lib/home";

export const Route = createFileRoute("/_public/")({
  /**
   * Authed users skip the marketing page entirely — redirect in beforeLoad so
   * they never see a flash of the landing content.
   */
  beforeLoad: async ({ context }) => {
    const me = await loadMe(context.queryClient);
    if (me?.user) {
      throw redirect({ to: homeTarget(me) });
    }
  },
  component: HomeComponent,
});

function HomeComponent() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <MarketingHeader />
      <HeroSection />
      <ModulesSection />
      <WorkflowSection />
      <TenantFirstSection />
      <CtaSection />
    </main>
  );
}
