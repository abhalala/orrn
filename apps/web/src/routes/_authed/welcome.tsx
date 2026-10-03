import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Stepper } from "@orrn/ui/components/stepper";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { CompanyStep } from "@/features/auth/welcome/company-step";
import { DoneStep } from "@/features/auth/welcome/done-step";
import { PasswordStep } from "@/features/auth/welcome/password-step";
import { TwoFactorStep } from "@/features/auth/welcome/two-factor-step";
import { parseMagicFlag, welcomeSteps, welcomeTimeline } from "@/features/auth/welcome-steps";
import { homeTarget } from "@/shared/lib/home";
import { signOutAndReset } from "@/shared/lib/sign-out";

/**
 * One stepper for everything a person still owes before the app (spec
 * section 3): set password, two-factor, company details, done. Only the
 * steps `auth.me` says are open are shown. The old `/setup-credentials`
 * (magic link, `?magic=1`), `/onboarding` and `/change-password` land here.
 */
export const Route = createFileRoute("/_authed/welcome")({
  validateSearch: (search: Record<string, unknown>): { magic?: 1 } => (parseMagicFlag(search.magic) ? { magic: 1 } : {}),
  beforeLoad: ({ context, search }) => {
    const { me } = context;
    const steps = welcomeSteps(me, { magic: search.magic === 1 });
    // Nothing left to do: home, like the old /change-password did. (People
    // with only their onboarding flag open still see the closing screen.)
    if (steps.length === 0 && (me.user.onboardingCompleted || me.impersonation)) {
      throw redirect({ to: homeTarget(me), replace: true });
    }
  },
  component: WelcomePage,
});

function WelcomePage() {
  const { t } = useT();
  const navigate = useNavigate();
  const { me } = Route.useRouteContext();
  const { magic } = Route.useSearch();
  // Fixed for this visit: finishing a step must not reshuffle the stepper.
  const [stages] = useState(() => welcomeTimeline(welcomeSteps(me, { magic: magic === 1 })));
  const [index, setIndex] = useState(0);
  const password = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (index > 0) heading.current?.focus();
  }, [index]);

  const stage = stages[index] ?? "done";
  const advance = () => setIndex((i) => Math.min(i + 1, stages.length - 1));

  return (
    <AuthFrame
      width="wide"
      footer={
        <div className="flex justify-center">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => void signOutAndReset(() => void navigate({ to: "/login", replace: true }))}
          >
            {t("auth.signOut")}
          </Button>
        </div>
      }
    >
      {stages.length > 1 ? (
        <Stepper steps={stages.map((s) => t(`welcome.steps.${s}`))} current={index} className="mb-8" />
      ) : null}

      {stage === "password" ? (
        <PasswordStep
          headingRef={heading}
          forced={Boolean(me.user.mustChangePassword)}
          onDone={(pw) => {
            // Kept in memory only, and only when the two-factor step needs it next.
            password.current = stages[index + 1] === "twoFactor" ? pw : null;
            advance();
          }}
        />
      ) : stage === "twoFactor" ? (
        <TwoFactorStep
          headingRef={heading}
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
