import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Stepper } from "@orrn/ui/components/stepper";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { CompanyStep } from "@/features/auth/welcome/company-step";
import { DoneStep } from "@/features/auth/welcome/done-step";
import { PasswordStep } from "@/features/auth/welcome/password-step";
import { TwoFactorStep } from "@/features/auth/welcome/two-factor-step";
import { leaveWelcome, welcomeSteps, welcomeTimeline } from "@/features/auth/welcome-steps";
import { homeTarget } from "@/shared/lib/home";
import { useSignOutAndReset } from "@/shared/lib/use-sign-out";
import { trpc } from "@/shared/utils/trpc";

/**
 * One stepper for everything a person still owes before the app (spec
 * section 3): set password, two-factor, company details, done. Only the
 * steps `auth.me` says are open are shown, so a reload, a detour or a later
 * sign-in resumes at the first open step. The old `/setup-credentials`
 * (magic link), `/onboarding` and `/change-password` land here.
 */
export const Route = createFileRoute("/_authed/welcome")({
  beforeLoad: ({ context }) => {
    const { me } = context;
    // Nothing left to do here: home, like the old /change-password did.
    if (leaveWelcome(me, welcomeSteps(me))) {
      throw redirect({ to: homeTarget(me), replace: true });
    }
  },
  component: WelcomePage,
});

function WelcomePage() {
  const { t } = useT();
  const navigate = useNavigate();
  const signOut = useSignOutAndReset();
  const { me } = Route.useRouteContext();
  // Fixed for this visit: finishing a step must not reshuffle the stepper.
  const [stages] = useState(() => welcomeTimeline(welcomeSteps(me)));
  const [index, setIndex] = useState(0);
  const password = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (index > 0) heading.current?.focus();
  }, [index]);

  const stage = stages[index] ?? "done";
  // `hasPassword` is read live, so Sign out returns once the password step is done.
  const live = useQuery(trpc.auth.me.queryOptions()).data;
  const canSignOut = (live ?? me).user.hasPassword !== false;
  const advance = () => setIndex((i) => Math.min(i + 1, stages.length - 1));

  return (
    <AuthFrame
      width="wide"
      footer={
        // No Sign out while there is no password: a magic-link owner who
        // leaves has no way back in (no reset flow, the link was single-use).
        canSignOut ? (
          <div className="flex justify-center">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => signOut(() => void navigate({ to: "/login", replace: true }))}
            >
              {t("auth.signOut")}
            </Button>
          </div>
        ) : undefined
      }
    >
      {stages.length > 1 ? (
        <Stepper steps={stages.map((s) => t(`welcome.steps.${s}`))} current={index} className="mb-8" />
      ) : null}

      {stage === "password" ? (
        <PasswordStep
          headingRef={heading}
          forced={Boolean(me.user.mustChangePassword) && me.user.hasPassword !== false}
          onDone={(pw) => {
            // Kept in memory only, and only when the two-factor step needs it next.
            password.current = stages[index + 1] === "twoFactor" ? pw : null;
            advance();
          }}
        />
      ) : stage === "twoFactor" ? (
        <TwoFactorStep
          headingRef={heading}
          userId={me.user.id}
          password={password.current}
          onDone={() => {
            password.current = null;
            advance();
          }}
        />
      ) : stage === "company" ? (
        <CompanyStep headingRef={heading} me={me} onDone={advance} />
      ) : (
        <DoneStep headingRef={heading} initialMe={me} joinedOnly={stages.length === 1} />
      )}
    </AuthFrame>
  );
}
