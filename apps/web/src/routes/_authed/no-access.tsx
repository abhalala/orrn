import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Link, createFileRoute, isRedirect, redirect, useNavigate } from "@tanstack/react-router";
import { Copy } from "lucide-react";
import { toast } from "sonner";

import { AuthFrame } from "@/features/auth/auth-frame";
import { homeTarget } from "@/shared/lib/home";
import { useSignOutAndReset } from "@/shared/lib/use-sign-out";
import { trpc } from "@/shared/utils/trpc";

/**
 * Signed in, but in no company (and not platform staff). Explains it, shows
 * which email is signed in so they can pass it to their admin, and offers a
 * clean way to switch accounts. Anyone with a home elsewhere goes there.
 */
export const Route = createFileRoute("/_authed/no-access")({
  beforeLoad: async ({ context }) => {
    const home = homeTarget(context.me);
    if (home !== "/no-access") throw redirect({ to: home, replace: true });
    // A party (a login in the customer portal, no plant membership) belongs on the portal.
    try {
      const plants = await context.queryClient.fetchQuery({ ...trpc.portal.access.queryOptions(), staleTime: 30_000, retry: false });
      if (plants.length > 0) throw redirect({ to: "/portal" as never, replace: true });
    } catch (error) {
      if (isRedirect(error)) throw error;
    }
  },
  component: NoAccessPage,
});

function NoAccessPage() {
  const { t } = useT();
  const navigate = useNavigate();
  const signOut = useSignOutAndReset();
  const { me } = Route.useRouteContext();
  const email = me.user.email;

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(email);
      toast.success(t("common.copied"));
    } catch {
      // Clipboard blocked: the email is on screen to copy by hand.
    }
  };

  return (
    <AuthFrame>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <h1 className="orrn-auth-title">{t("auth.noAccess.title")}</h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("auth.noAccess.ask")}</p>
        </div>

        <div className="orrn-block orrn-block-amber orrn-block-sheen flex flex-col gap-4 p-[18px]">
          <p className="relative m-0 text-[15px] font-semibold leading-6">{t("auth.noAccess.signedInLabel")}</p>
          <p data-no-truncate="" className="relative m-0 font-display text-[24px] font-extrabold leading-tight tracking-[-0.02em] [overflow-wrap:anywhere]">
            {email}
          </p>
          <Button variant="secondary" className="relative self-start" onClick={() => void copyEmail()}>
            <Copy aria-hidden="true" strokeWidth={2} />
            {t("auth.noAccess.copyEmail")}
          </Button>
        </div>

        <Button
          size="lg"
          className="h-auto min-h-14 w-full whitespace-normal py-3 text-center"
          onClick={() => signOut(() => void navigate({ to: "/login", replace: true }))}
        >
          {t("auth.noAccess.switchAccount")}
        </Button>

        <p className="m-0 border-t border-border pt-5 text-[15px] leading-6 text-muted-foreground">
          {t("auth.noAccess.ownPlant")}{" "}
          <Link
            to="/request-access"
            className="inline-flex min-h-11 items-center font-semibold text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
          >
            {t("auth.login.requestAccess")}
          </Link>
        </p>
      </div>
    </AuthFrame>
  );
}
