import { Outlet, createFileRoute } from "@tanstack/react-router";

import { StaffShell } from "@/shared/components/staff-shell";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_platform")({
  component: PlatformLayout,
});

function PlatformLayout() {
  return (
    <>
      <TenantCacheGuard />
      <StaffShell>
        <Outlet />
      </StaffShell>
    </>
  );
}