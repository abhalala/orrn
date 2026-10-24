import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { env } from "@orrn/env/web";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";

export const Route = createFileRoute("/_public/continue")({
  component: ContinuePage,
  // Plain check (no zod): route options sit in the entry chunk every page loads.
  validateSearch: (search: Record<string, unknown>): { token?: string; error?: string } => ({
    ...(typeof search.token === "string" && search.token ? { token: search.token } : {}),
    ...(typeof search.error === "string" && search.error ? { error: search.error } : {}),
  }),
});

/**
 * Landing page for the owner sign-in link Godseye sends or shares after an
 * approval. The one-time token is spent only when the person taps Continue:
 * link previews (WhatsApp, mail scanners) open the URL and would use it up if
 * it went straight to the verify address. Better Auth sends a failed verify
 * back here with `?error=...`.
 */
function ContinuePage() {
  const { t } = useT();
  const { token, error } = Route.useSearch();
  const [leaving, setLeaving] = useState(false);
  const broken = Boolean(error) || !token;

  const proceed = () => {
    if (!token) return;
    setLeaving(true);
    const origin = window.location.origin;
    const verify = new URL("/api/auth/magic-link/verify", env.VITE_SERVER_URL);
    verify.searchParams.set("token", token);
    verify.searchParams.set("callbackURL", `${origin}/setup-credentials`);
    verify.searchParams.set("errorCallbackURL", `${origin}/continue`);
    window.location.assign(verify.toString());
  };

  return (
    <AuthFrame brand>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="orrn-auth-title">{broken ? t("auth.continue.brokenTitle") : t("auth.continue.title")}</h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            {broken ? t("auth.continue.brokenBody") : t("auth.continue.body")}
          </p>
        </div>
        {broken ? (
          <Button asChild size="lg" className="w-full">
            <Link to="/login">{t("auth.continue.goSignIn")}</Link>
          </Button>
        ) : (
          <Button size="lg" className="w-full" loading={leaving} onClick={proceed}>
            {t("auth.continue.button")}
          </Button>
        )}
      </div>
    </AuthFrame>
  );
}
