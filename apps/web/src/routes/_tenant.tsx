import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkspaceNotFound } from "@/shared/components/not-found";
import { requireCompanyMe } from "@/shared/lib/guards";
import { TenantFrame } from "@/shell/tenant-frame";

export const Route = createFileRoute("/_tenant")({
  beforeLoad: requireCompanyMe,
  component: TenantLayout,
  /* Renders inside the shell so users keep their navigation. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/today" homeLabel="Today" />,
});

function TenantLayout() {
  return (
    <TenantFrame>
      <Outlet />
    </TenantFrame>
  );
}
