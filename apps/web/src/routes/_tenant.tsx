import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/shared/components/app-shell";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_tenant")({
  component: TenantLayout,
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