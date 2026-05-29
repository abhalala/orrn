import { createFileRoute, redirect } from "@tanstack/react-router";

import ForcePasswordChangeForm from "@orrn/web-shared/components/force-password-change-form";
import type { Me } from "@orrn/web-shared/lib/me";
import { trpc } from "@orrn/web-shared/utils/trpc";

export const Route = createFileRoute("/change-password")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient
      .ensureQueryData(trpc.auth.me.queryOptions())
      .catch(() => null);

    if (!me) {
      throw redirect({ to: "/" });
    }
    const typed = me as Me;
    if (!typed.user.mustChangePassword) {
      throw redirect({ to: "/dashboard" });
    }
  },
  component: ChangePasswordComponent,
});

function ChangePasswordComponent() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center p-4 bg-[#0b0f1a] overflow-hidden w-full">
      <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-gradient-to-r from-[#5B6CFF]/15 to-[#22D3EE]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />
      <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-gradient-to-l from-[#22D3EE]/10 to-[#5B6CFF]/5 rounded-full blur-[100px] pointer-events-none -z-10 animate-pulse duration-[8000ms]" />

      <ForcePasswordChangeForm
        onSuccess={() => {
          window.location.replace("/dashboard");
        }}
      />
    </div>
  );
}
