import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/shared/components/app-shell";
import { WorkspaceNotFound } from "@/shared/components/not-found";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_tenant")({
  component: TenantLayout,
  /* Renders inside the AppShell outlet so users keep their navigation. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/dashboard" homeLabel="Dashboard" />,
});

function TenantLayout() {
  return (
    <>
      <TenantCacheGuard />
      <AppShell>
        <Outlet />
      </AppShell>
    </>
  );
}