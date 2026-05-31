import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { requireCompanyMe } from "@/shared/lib/guards";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_tenant/dashboard")({
  component: RouteComponent,
  beforeLoad: requireCompanyMe,
});

function RouteComponent() {
  const { me } = Route.useRouteContext();
  const privateData = useQuery(trpc.privateData.queryOptions());

  const plan = me.company?.plan?.toLowerCase() || "starter";
  const modules = me.company?.modules || [];

  // Helper to check if a module is enabled
  const hasModule = (name: string) => {
    return modules.map((m: string) => m.toLowerCase()).includes(name.toLowerCase());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={me.company ? `${me.company.name} • ${plan.toUpperCase()} Plan` : "ORRN"}
        title={`Welcome back, ${me.user.name.split(" ")[0]}.`}
        description="Operational snapshot for your plant facility. Active modules are enabled below."
      />

      {/* Dynamic Operations Guide */}
      <Card className="border-[#5B6CFF]/30 bg-[#121826]/40 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-[#22D3EE] font-bold text-lg flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Operations Guide ({plan.toUpperCase()})
          </CardTitle>
          <CardDescription>Tailored instructions based on your plant active configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-3 text-sm text-muted-foreground">
            {plan === "starter" && (
              <li className="flex gap-2">
                <span className="text-[#5B6CFF] font-bold">✓</span>
                <span>Your plant is running on the <strong>Starter</strong> tier. You can organize customers and register dies.</span>
              </li>
            )}
            {plan === "growth" && (
              <li className="flex gap-2">
                <span className="text-[#5B6CFF] font-bold">✓</span>
                <span>You have access to <strong>Growth</strong> parameters including bundle lifecycles and production receipts.</span>
              </li>
            )}
            {plan === "enterprise" && (
              <li className="flex gap-2">
                <span className="text-[#5B6CFF] font-bold">✓</span>
                <span><strong>Enterprise</strong> mode enabled. You can connect automated printing queues and scale dispatches.</span>
              </li>
            )}
            
            {/* Module Specific Guides */}
            {hasModule("dies") && (
              <li className="flex gap-2">
                <span className="text-[#22D3EE] font-bold">→</span>
                <span>Go to <Link to="/dies" className="text-[#5B6CFF] hover:underline">Dies</Link> to configure aluminum profile weights and press settings.</span>
              </li>
            )}
            {hasModule("bundles") && (
              <li className="flex gap-2">
                <span className="text-[#22D3EE] font-bold">→</span>
                <span>Create a new <Link to="/receipts" className="text-[#5B6CFF] hover:underline">Receipt</Link> to log completed extrusion press cycles and generate bundle tags.</span>
              </li>
            )}
            {hasModule("dispatches") && (
              <li className="flex gap-2">
                <span className="text-[#22D3EE] font-bold">→</span>
                <span>Use <Link to="/dispatches" search={{ status: "all" }} className="text-[#5B6CFF] hover:underline">Dispatches</Link> to prepare shipping runs, allocate bundles to trailers, and download packing lists.</span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {hasModule("customers") ? (
          <ModuleCard to="/customers" title="Customers" description="People and companies you sell to." />
        ) : (
          <LockedModuleCard title="Customers" description="Setup customer profiles (Dies module required)." />
        )}
        
        {hasModule("dies") ? (
          <ModuleCard to="/dies" title="Dies" description="Master inventory of section profiles." />
        ) : (
          <LockedModuleCard title="Dies" description="Inventory of section profiles (Growth plan required)." />
        )}

        {hasModule("bundles") ? (
          <>
            <ModuleCard to="/receipts" title="Receipts" description="Production receipts and the bundles they spawn." />
            <ModuleCard to="/bundles" title="Bundles" description="Every bundle, its status, and where it lives." />
            <ModuleCard to="/stock" title="Stock" description="Aggregated stock totals by die." />
          </>
        ) : (
          <>
            <LockedModuleCard title="Receipts" description="Record production logs & spawn bundles." />
            <LockedModuleCard title="Bundles" description="Bundle inventory and tracking." />
            <LockedModuleCard title="Stock" description="Aggregate stock totals." />
          </>
        )}

        {hasModule("dispatches") ? (
          <ModuleCard to="/dispatches" title="Dispatches" description="Outbound shipments and reservations." />
        ) : (
          <LockedModuleCard title="Dispatches" description="Outbound shipments & logistics (Enterprise required)." />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>API status</CardTitle>
          <CardDescription>End-to-end check against the tRPC server.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            {privateData.isLoading
              ? "Checking…"
              : privateData.data?.message || "Disconnected"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleCard({ to, title, description }: { to: string; title: string; description: string }) {
  return (
    <Link to={to as any} className="no-underline">
      <Card className="hover:border-[#5B6CFF]/50 transition-colors duration-200">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function LockedModuleCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="opacity-55 cursor-not-allowed border-dashed bg-[#0b0f1a]/30">
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-muted-foreground">
          {title}
          <span className="text-[10px] uppercase font-bold tracking-wider bg-muted text-muted-foreground px-2 py-0.5 rounded border border-border/40">
            Locked
          </span>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
