import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthScreen } from "@/shared/components/auth-screen";
import { requireSignedIn } from "@/shared/lib/guards";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireSignedIn,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <AuthScreen>
      <Outlet />
    </AuthScreen>
  );
}
