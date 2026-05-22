import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

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
    <div className="p-6">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="mt-2 text-muted-foreground">
        Welcome {me.user.name} {me.company ? `· ${me.company.name}` : null}
      </p>
      <p className="mt-1 text-sm">API: {privateData.data?.message}</p>
    </div>
  );
}
