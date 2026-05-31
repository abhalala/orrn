import { Outlet, createFileRoute } from "@tanstack/react-router";

import { TenantCacheGuard } from "@/shared/components/tenant-cache-guard";

export const Route = createFileRoute("/_authed")({
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-background overflow-hidden w-full">
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gradient-to-r from-[#5B6CFF]/15 to-[#22D3EE]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-gradient-to-l from-[#22D3EE]/10 to-[#5B6CFF]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <TenantCacheGuard />
      <Outlet />
    </div>
  );
}