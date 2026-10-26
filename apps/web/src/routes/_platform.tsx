import { Outlet, createFileRoute } from "@tanstack/react-router";

import { WorkspaceNotFound } from "@/shared/components/not-found";
import { requirePlatformAdmin } from "@/shared/lib/guards";
import { AppShell } from "@/shell/app-shell";

export const Route = createFileRoute("/_platform")({
  beforeLoad: requirePlatformAdmin,
  component: PlatformLayout,
  /* Renders inside the shell so staff keep the Godseye chrome. */
  notFoundComponent: () => <WorkspaceNotFound homePath="/admin" homeLabel="Godseye" />,
});

/** Same shell as companies, in the violet Godseye tone with the admin pages. */
function PlatformLayout() {
  return (
    <AppShell variant="godseye">
      <Outlet />
    </AppShell>
  );
}
