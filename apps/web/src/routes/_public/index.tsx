import { createFileRoute, redirect } from "@tanstack/react-router";

import { MarketingHeader } from "@/features/marketing/marketing-header";
import { CtaSection } from "@/features/marketing/sections/cta";
import { HeroSection } from "@/features/marketing/sections/hero";
import { ModulesSection } from "@/features/marketing/sections/modules";
import { TenantFirstSection } from "@/features/marketing/sections/tenant-first";
import { WorkflowSection } from "@/features/marketing/sections/workflow";
import type { Me } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_public/")({
  /**
   * Authed users skip the marketing page entirely — redirect in beforeLoad so
   * they never see a flash of the landing content.
   */
  beforeLoad: async ({ context }) => {
    let me: Me | null = null;
    try {
      me = (await context.queryClient.ensureQueryData(trpc.auth.me.queryOptions())) as Me;
    } catch {
      me = null;
    }
    if (me?.user) {
      throw redirect({ to: me.isPlatformAdmin ? "/admin" : "/dashboard" });
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
