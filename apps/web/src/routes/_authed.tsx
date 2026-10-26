import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { ImpersonationBanner } from "@/shared/components/impersonation-banner";
import { requireSignedIn } from "@/shared/lib/guards";
import { legacyWelcomeLink } from "@/shared/lib/redirects";

/**
 * Signed-in screens outside the app shell: /welcome and /no-access. Each page
 * draws its own front-door frame (`features/auth/auth-frame.tsx`).
 */
export const Route = createFileRoute("/_authed")({
  beforeLoad: (args) => {
    // An old owner link (/welcome?token=...) is a public page now at /continue.
    const legacy = legacyWelcomeLink(args.location.pathname, args.location.searchStr);
    if (legacy) throw redirect({ href: legacy, replace: true });
    return requireSignedIn(args);
  },
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
