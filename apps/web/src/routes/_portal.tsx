import { Outlet, createFileRoute } from "@tanstack/react-router";

import { PortalLoadFailed } from "@/features/portal/portal-load-failed";
import { PortalNotFound } from "@/features/portal/portal-not-found";
import { PortalShell } from "@/features/portal/portal-shell";
import { requirePortal } from "@/shared/lib/portal-guard";

/**
 * The customer portal (FP-PF-01..04): a frame of its own for parties. A party is not a plant member,
 * so there is no plant navigation and no `<Can>` matrix here; the door is `portal.access`, and every
 * `portal.*` call is checked again on the server.
 */
export const Route = createFileRoute("/_portal")({
  beforeLoad: requirePortal,
  component: PortalLayout,
  notFoundComponent: PortalNotFound,
  errorComponent: PortalLoadFailed,
});

function PortalLayout() {
  return (
    <PortalShell>
      <Outlet />
    </PortalShell>
  );
}
