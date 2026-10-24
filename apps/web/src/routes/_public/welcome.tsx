import { Button } from "@orrn/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader } from "@orrn/ui/components/card";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

import { AuthScreen } from "@/shared/components/auth-screen";
import { appUrls } from "@/shared/lib/urls";

export const Route = createFileRoute("/_public/welcome")({
  validateSearch: z.object({
    token: z.string().optional(),
    error: z.string().optional(),
  }),
  component: WelcomeComponent,
});

/**
 * Landing page for a new company owner's sign-in link. The one-time token is
 * only spent when the person taps Continue, so link previews (WhatsApp, mail
 * scanners) that open the URL do not use it up.
 */
function WelcomeComponent() {
  const { token, error } = Route.useSearch();
  const [isLeaving, setIsLeaving] = useState(false);

  const handleContinue = () => {
    if (!token) return;
    setIsLeaving(true);
    const origin = window.location.origin;
    const verify = new URL("/api/auth/magic-link/verify", appUrls.api);
    verify.searchParams.set("token", token);
    verify.searchParams.set("callbackURL", `${origin}/setup-credentials`);
    verify.searchParams.set("errorCallbackURL", `${origin}/welcome`);
    window.location.assign(verify.toString());
  };

  const broken = Boolean(error) || !token;

  return (
    <AuthScreen>
      <Card className="w-full max-w-md gap-6 p-6 shadow-md sm:p-8">
        <CardHeader>
          <h1 className="orrn-auth-title">{broken ? "This link no longer works" : "Welcome to ORRN"}</h1>
          <CardDescription className="text-[15px] leading-6">
            {broken
              ? "It was already used or has expired. Ask the person who sent it for a new sign-in link."
              : "Your company's workspace is ready. Tap Continue to sign in and set your password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {broken ? (
            <Button asChild variant="outline" className="w-full">
              <Link to="/login">Go to sign in</Link>
            </Button>
          ) : (
            <Button className="w-full" loading={isLeaving} onPress={handleContinue}>
              Continue
            </Button>
          )}
        </CardContent>
      </Card>
    </AuthScreen>
  );
}
