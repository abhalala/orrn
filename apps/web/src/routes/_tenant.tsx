import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ScanProvider } from "@/features/scan/scan-context";
import { WorkspaceNotFound } from "@/shared/components/not-found";
import { requireCompanyMe } from "@/shared/lib/guards";
import { AppShell } from "@/shell/app-shell";

export const Route = createFileRoute("/_tenant")({
  beforeLoad: requireCompanyMe,
  component: TenantLayout,
  /* Renders inside the shell so users keep their navigation. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/today" homeLabel="Today" />,
});

function TenantLayout() {
  return (
    <ScanProvider>
      <AppShell variant="tenant">
        <Outlet />
      </AppShell>
    </ScanProvider>
  );
}
