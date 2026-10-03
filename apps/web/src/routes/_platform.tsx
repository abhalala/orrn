import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkspaceNotFound } from "@/shared/components/not-found";
import { StaffShell } from "@/shared/components/staff-shell";
import { requirePlatformAdmin } from "@/shared/lib/guards";

export const Route = createFileRoute("/_platform")({
  beforeLoad: requirePlatformAdmin,
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
      <StaffShell>
        <Outlet />
      </StaffShell>
    </div>
  );
}