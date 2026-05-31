import { Outlet, createFileRoute } from "@tanstack/react-router";

import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <TenantCacheGuard />
      <Outlet />
    </div>
  );
}
