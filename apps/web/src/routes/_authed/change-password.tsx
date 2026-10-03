import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import ForcePasswordChangeForm from "@/shared/components/force-password-change-form";
import type { Me } from "@/shared/lib/me";
import { loadMe, toLogin } from "@/shared/lib/guards";
import { homeTarget } from "@/shared/lib/home";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_authed/change-password")({
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.queryClient);
    if (!me) {
      throw toLogin(location);
    }
    if (!me.user.mustChangePassword) {
      throw redirect({ to: homeTarget(me) });
    }
  },
  component: ChangePasswordComponent,
});

function ChangePasswordComponent() {
  const meQuery = useQuery(trpc.auth.me.queryOptions());
  const me = meQuery.data as Me | undefined;

  return (
    <ForcePasswordChangeForm
      onSuccess={() => {
        window.location.replace(me?.isPlatformAdmin ? "/admin" : "/dashboard");
      }}
    />
  );
}
