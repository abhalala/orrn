import { Outlet, createFileRoute } from "@tanstack/react-router";

import { ImpersonationBanner } from "@/shared/components/impersonation-banner";
import { requireSignedIn } from "@/shared/lib/guards";

/**
 * Signed-in screens outside the app shell: /welcome and /no-access. Each page
 * draws its own front-door frame (`features/auth/auth-frame.tsx`).
 */
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
      <Outlet />
    </>
  );
}
