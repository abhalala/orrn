import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/shared/components/auth-screen";
import { ImpersonationBanner } from "@/shared/components/impersonation-banner";
import { requireSignedIn } from "@/shared/lib/guards";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireSignedIn,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <>
      {/* Every authenticated screen shows the banner while impersonating (AGENTS.md). */}
      <div className="sticky top-0 z-30">
        <ImpersonationBanner />
      </div>
      <AuthScreen>
        <Outlet />
      </AuthScreen>
    </>
  );
}
