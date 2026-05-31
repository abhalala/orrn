import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import ForcePasswordChangeForm from "@/shared/components/force-password-change-form";
import type { Me } from "@/shared/lib/me";
import { trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_authed/change-password")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient
      .ensureQueryData(trpc.auth.me.queryOptions())
      .catch(() => null);

    if (!me) {
      throw redirect({ to: "/login" });
    }
    const typed = me as Me;
    if (!typed.user.mustChangePassword) {
      throw redirect({ to: typed.isPlatformAdmin ? "/admin" : "/dashboard" });
    }
  },
  component: ChangePasswordComponent,
});

function ChangePasswordComponent() {
  const meQuery = useQuery(trpc.auth.me.queryOptions());
  const me = meQuery.data as Me | undefined;

  return (
    <div className="w-full max-w-md p-8 rounded-2xl border border-border/40 bg-card/60 backdrop-blur-md shadow-2xl space-y-6">
      <ForcePasswordChangeForm
        onSuccess={() => {
          window.location.replace(me?.isPlatformAdmin ? "/admin" : "/dashboard");
        }}
      />
    </div>
  );
}