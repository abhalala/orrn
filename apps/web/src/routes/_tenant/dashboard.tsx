import { Badge } from "@orrn/ui/components/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight, LockKeyhole } from "lucide-react";

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
  const planLabel = `${plan.charAt(0).toUpperCase()}${plan.slice(1)} plan`;
  const modules = me.company?.modules || [];

  // Helper to check if a module is enabled
  const hasModule = (name: string) => {
    return modules.map((m: string) => m.toLowerCase()).includes(name.toLowerCase());
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={planLabel}
        title={`Welcome back, ${me.user.name.split(" ")[0]}.`}
        description="Operational snapshot for your plant facility. Active modules are enabled below."
      />

      {["starter", "growth", "enterprise"].includes(plan) || hasModule("dies") || hasModule("bundles") || hasModule("dispatches") ? (
      <Card>
        <CardHeader>
          <CardTitle>Getting started on the {planLabel.toLowerCase()}</CardTitle>
          <CardDescription>Tailored instructions based on your plant active configuration.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-3 text-sm text-muted-foreground">
            {plan === "starter" && (
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>Your plant is running on the <strong>Starter</strong> tier. You can organize customers and register dies.</span>
              </li>
            )}
            {plan === "growth" && (
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span>You have access to <strong>Growth</strong> parameters including bundle lifecycles and production receipts.</span>
              </li>
            )}
            {plan === "enterprise" && (
              <li className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                <span><strong>Enterprise</strong> mode enabled. You can connect automated printing queues and scale dispatches.</span>
              </li>
            )}
            
            {/* Module Specific Guides */}
            {hasModule("dies") && (
              <li className="flex gap-2">
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Go to <Link to="/dies" className="text-primary hover:underline">Dies</Link> to configure aluminum profile weights and press settings.</span>
              </li>
            )}
            {hasModule("bundles") && (
              <li className="flex gap-2">
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Start a <Link to="/receipts" className="text-primary hover:underline">packing session</Link> to log completed extrusion press cycles and generate bundle tags.</span>
              </li>
            )}
            {hasModule("dispatches") && (
              <li className="flex gap-2">
                <ChevronRight size={16} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>Use <Link to="/dispatches" search={{ status: "all" }} className="text-primary hover:underline">Dispatches</Link> to prepare shipping runs, allocate bundles to trailers, and download packing lists.</span>
              </li>
            )}
          </ul>
        </CardContent>
      </Card>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3 sm:gap-4">
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
            <ModuleCard to="/receipts" title="Packing" description="Packing sessions and the bundles they create." />
            <ModuleCard to="/bundles" title="Bundles" description="Every bundle, its status, and where it lives." />
            <ModuleCard to="/stock" title="Stock" description="Aggregated stock totals by die." />
          </>
        ) : (
          <>
            <LockedModuleCard title="Packing" description="Record production and create bundles." />
            <LockedModuleCard title="Bundles" description="Bundle inventory and tracking." />
            <LockedModuleCard title="Stock" description="Aggregate stock totals." />
          </>
        )}

        {hasModule("dispatches") ? (
          <ModuleCard to="/dispatches" title="Dispatches" description="Outbound shipments and reservations." />
        ) : (
          <LockedModuleCard title="Dispatches" description="Outbound shipments and packing lists (Enterprise plan)." />
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
    <Link to={to as any} className="group block min-w-0 rounded-card no-underline">
      <Card className="h-full flex-row items-center gap-3 p-4 transition-[border-color,transform] duration-[var(--dur-fast)] hover:border-control/60 group-active:scale-[0.99] sm:p-5">
        <CardHeader className="min-w-0 flex-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </Card>
    </Link>
  );
}

function LockedModuleCard({ title, description }: { title: string; description: string }) {
  return (
    <Card className="border-dashed bg-transparent p-4 shadow-none sm:p-5">
      <CardHeader className="min-w-0">
        <CardTitle className="flex min-w-0 items-center justify-between gap-3 text-muted-foreground">
          <span className="min-w-0 truncate">{title}</span>
          <Badge tone="neutral">
            <LockKeyhole size={11} aria-hidden="true" /> Locked
          </Badge>
        </CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
    </Card>
  );
}
