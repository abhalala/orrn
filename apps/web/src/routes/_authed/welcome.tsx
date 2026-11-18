import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Stepper } from "@orrn/ui/components/stepper";
import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { CompanyStep } from "@/features/auth/welcome/company-step";
import { DoneStep } from "@/features/auth/welcome/done-step";
import { PasswordStep } from "@/features/auth/welcome/password-step";
import { googleLinkErrorKey } from "@/features/auth/google-link";
import { SecureSignInStep } from "@/features/auth/welcome/secure-sign-in-step";
import { leaveWelcome, welcomeSteps, welcomeTimeline } from "@/features/auth/welcome-steps";
import { homeTarget } from "@/shared/lib/home";
import { useSignOutAndReset } from "@/shared/lib/use-sign-out";
import { trpc } from "@/shared/utils/trpc";

/**
 * One stepper for everything a person still owes before the app (spec
 * section 3; owner amendment 2026-11-18): set password, secure sign-in (only
 * when the active plant requires it), company details (this plant's setup),
 * done. Only the steps `auth.me` says are open are shown, so a reload, a
 * detour or a later sign-in resumes at the first open step. The old
 * `/setup-credentials` (magic link), `/onboarding` and `/change-password` land
 * here. A person in several plants can leave for "Choose a plant": another
 * plant's policy or setup does not hold them here.
 */
export const Route = createFileRoute("/_authed/welcome")({
  // `?error=`: a Google link from "Secure your sign-in" that failed (Better Auth appends the code).
  validateSearch: (search: Record<string, unknown>): { error?: string } =>
    typeof search.error === "string" && search.error ? { error: search.error.slice(0, 64) } : {},
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
  const { error: linkCode } = Route.useSearch();
  // Fixed for this visit: finishing a step must not reshuffle the stepper.
  const [stages] = useState(() => welcomeTimeline(welcomeSteps(me)));
  const [index, setIndex] = useState(0);
  const password = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (index > 0) heading.current?.focus();
  }, [index]);

  const stage = stages[index] ?? "done";
  // Read live, so Sign out returns once the password step is done. A passkey or Google is a way
  // back in too (plan 2026-11-18).
  const live = useQuery(trpc.auth.me.queryOptions()).data;
  const liveUser = (live ?? me).user;
  const canSignOut = liveUser.hasPassword !== false || liveUser.hasPasskey === true || liveUser.hasGoogle === true;
  // Not before a way in exists (the password step), and never while impersonating.
  const canPickPlant = canSignOut && !me.impersonation && (me.memberships?.length ?? 0) > 1;
  const advance = () => setIndex((i) => Math.min(i + 1, stages.length - 1));

  return (
    <AuthFrame
      width="wide"
      footer={
        // No Sign out while there is no password: a magic-link owner who
        // leaves has no way back in (no reset flow, the link was single-use).
        canSignOut ? (
          <div className="flex flex-wrap justify-center gap-2">
            {canPickPlant ? (
              <Button variant="ghost" className="text-muted-foreground" asChild>
                <Link to="/choose-plant" data-testid="welcome-choose-plant">
                  {t("auth.choosePlant.another")}
                </Link>
              </Button>
            ) : null}
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
            // Kept in memory only, and only when the secure sign-in step needs it next.
            password.current = stages[index + 1] === "secureSignIn" ? pw : null;
            advance();
          }}
        />
      ) : stage === "secureSignIn" ? (
        <SecureSignInStep
          headingRef={heading}
          userId={me.user.id}
          email={me.user.email}
          plantName={me.company?.name ?? ""}
          linkError={googleLinkErrorKey(linkCode)}
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
