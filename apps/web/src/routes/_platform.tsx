import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkspaceNotFound } from "@/shared/components/not-found";
import { StaffShell } from "@/shared/components/staff-shell";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_platform")({
  component: PlatformLayout,
  /* Renders inside the StaffShell outlet so staff keep the Godseye chrome. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/admin" homeLabel="Godseye" />,
});

function PlatformLayout() {
  return (
    /*
     * `.godseye` swaps the brand accent CSS vars to the violet identity so
     * staff always know they're on the platform surface. `contents` keeps it
     * out of layout.
     */
    <div className="godseye contents">
      <TenantCacheGuard />
      <StaffShell>
        <Outlet />
      </StaffShell>
    </div>
  );
}