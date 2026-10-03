import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/shared/components/app-shell";
import { WorkspaceNotFound } from "@/shared/components/not-found";
import { requireCompanyMe } from "@/shared/lib/guards";

export const Route = createFileRoute("/_tenant")({
  beforeLoad: requireCompanyMe,
  component: TenantLayout,
  /* Renders inside the AppShell outlet so users keep their navigation. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/dashboard" homeLabel="Dashboard" />,
});

function TenantLayout() {
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}