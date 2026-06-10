import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/shared/components/auth-screen";
import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <>
      <TenantCacheGuard />
      <AuthScreen>
        <Outlet />
      </AuthScreen>
    </>
  );
}
