import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@orrn/ui/components/card";
import { PageHeader } from "@orrn/ui/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { requireCompanyMe } from "@/lib/route-guards";
import { trpc } from "@/utils/trpc";

export const Route = createFileRoute("/dashboard")({
  component: RouteComponent,
  beforeLoad: requireCompanyMe,
});

function RouteComponent() {
  const { me } = Route.useRouteContext();
  const privateData = useQuery(trpc.privateData.queryOptions());

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={me.company ? me.company.name : "ORRN"}
        title={`Welcome back, ${me.user.name.split(" ")[0]}.`}
        description="Operational snapshot for your tenant. Use the sidebar to jump into a module."
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard to="/customers" title="Customers" description="People and companies you sell to." />
        <ModuleCard to="/dies" title="Dies" description="Master inventory of section profiles." />
        <ModuleCard to="/receipts" title="Receipts" description="Production receipts and the bundles they spawn." />
        <ModuleCard to="/bundles" title="Bundles" description="Every bundle, its status, and where it lives." />
        <ModuleCard to="/stock" title="Stock" description="Aggregated stock totals by die." />
        <ModuleCard to="/dispatches" title="Dispatches" description="Outbound shipments and reservations." />
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
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
