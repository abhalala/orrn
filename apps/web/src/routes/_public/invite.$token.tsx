import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { AltSignIn, OrLine, useAltSignInButtons } from "@/features/auth/alt-sign-in";
import { inviteAcceptOutcome, inviteSignUpRefusal, isExistingAccount, signInErrorKey } from "@/features/auth/auth-errors";
import { AuthFrame } from "@/features/auth/auth-frame";
import { FormAlert } from "@/features/auth/form-alert";
import { PasswordField } from "@/features/auth/password-field";
import { SignInForm } from "@/features/auth/sign-in-form";
import { useFinishSignIn } from "@/features/auth/use-finish-sign-in";
import { inviteView, type InviteLearned, type InviteSession, type InviteStatus, type InviteStatusRead } from "@/features/auth/invite-view";
import { usePageTitle } from "@/features/auth/use-page-title";
import { authClient } from "@/shared/lib/auth-client";
import { homeTarget, type HomePath } from "@/shared/lib/home";
import type { Me } from "@/shared/lib/me";
import { useSignOutAndReset } from "@/shared/lib/use-sign-out";
import { INLINE_ERROR_META } from "@/shared/lib/query-errors";
import { isUnauthorized } from "@/shared/lib/session-errors";
import { queryClient, trpc } from "@/shared/utils/trpc";

type InviteSearch = { kind?: "portal" };

export const Route = createFileRoute("/_public/invite/$token")({
  // A party invite link ends in `?kind=portal`: only the words on the page change; the server
  // decides what the token is when it is accepted.
  validateSearch: (search: Record<string, unknown>): InviteSearch => (search.kind === "portal" ? { kind: "portal" } : {}),
  component: InvitePage,
});

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The button that takes a signed-in person home from a dead invite link. */
const HOME_LABEL: Record<HomePath, MessageKey> = {
  "/today": "welcome.done.go",
  "/admin": "welcome.done.goAdmin",
  "/welcome": "welcome.done.goOther",
  "/no-access": "welcome.done.goOther",
  "/choose-plant": "welcome.done.goOther",
};

/**
 * Accept an invite (plan 2026-11-18, Task 8: every invite state has a way in). `invite.status` says
 * whether the link is live and what the invited email's account needs, without the email, the company
 * or the role; `inviteView` picks the view from it and the session. The page never accepts on load,
 * so a chat app's link preview changes nothing: every join waits for a tap.
 *
 * - Signed in already: join with this account, or sign out and use another.
 * - No account for the invite email: name, email, password (or Google), then join.
 * - An account with a password: sign in (passkey, Google or email + password), then join.
 * - An account with no password (a magic-link approval, Google or a passkey only): a way it already
 *   has (passkey, Google), or "Email me a link to set a password", whose link comes back here.
 * After joining, the person goes home: the welcome steps if any remain.
 */
function InvitePage() {
  const { t } = useT();
  const { token } = Route.useParams();
  const party = Route.useSearch().kind === "portal";
  const me = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });
  // Only a real "not signed in" answer counts: a 5xx or a network blip must not show the sign-up form.
  const signedOut = me.isError && me.data === undefined && isUnauthorized(me.error);
  const meFailed = me.isError && me.data === undefined && !signedOut;
  // Read once; a failure (offline, the per-IP limit) shows Try again, never a guess.
  const status = useQuery({
    ...trpc.invite.status.queryOptions({ token }),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: false,
    meta: INLINE_ERROR_META,
  });
  const [learned, setLearned] = useState<InviteLearned | null>(null);
  const [signInEmail, setSignInEmail] = useState("");
  const [acceptError, setAcceptError] = useState<MessageKey | null>(null);
  const finishSignIn = useFinishSignIn();
  const navigate = useNavigate();
  const signOut = useSignOutAndReset();
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const heading = useRef<HTMLHeadingElement>(null);

  const session: InviteSession = me.data ? "signedIn" : signedOut ? "signedOut" : meFailed ? "failed" : "pending";
  const statusRead: InviteStatusRead = status.data
    ? { state: "ready", status: status.data as InviteStatus }
    : status.isError
      ? { state: "failed" }
      : { state: "pending" };
  const view = inviteView({ session, status: statusRead, learned });
  const live = status.data && status.data.live ? status.data : null;

  const viewChanged = useRef(false);
  useEffect(() => {
    // A new view replaces the form: put focus on its heading so it is read out.
    if (viewChanged.current) heading.current?.focus();
    if (view !== "loading") viewChanged.current = true;
  }, [view]);

  /** Never throws: failures switch the view or show an inline error. */
  async function acceptInvite(name?: string) {
    setAcceptError(null);
    let accepted: { portal?: boolean } | undefined;
    try {
      accepted = (await accept.mutateAsync({ token, name })) as { portal?: boolean } | undefined;
    } catch (error) {
      const outcome = inviteAcceptOutcome(error);
      // They may have just signed in (the sign-in view): re-read who is
      // signed in, so a retry offers "Join with this account" and a dead link
      // offers their home instead of the sign-in form.
      await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
      if (outcome === "failed") setAcceptError("errors.generic");
      else setLearned(outcome);
      return;
    }
    // A party invite (kind portal) makes a portal login, not a membership: the party lands on the portal.
    if (accepted?.portal) {
      toast.success(t("portal.invite.joined"));
      queryClient.removeQueries();
      await navigate({ to: "/portal" as never, replace: true });
      return;
    }
    toast.success(t("auth.invite.joined"));
    await finishSignIn();
  }

  /** Sign out from the join or wrong-account view and show the signed-out views for this link. */
  const useAnotherAccount = () =>
    signOut(() => {
      setLearned(null);
      void queryClient.invalidateQueries(trpc.invite.status.queryFilter({ token }));
    });

  const signedInEmail = me.data?.user.email;
  const deadLink = view === "dead" || view === "wrongEmail";
  usePageTitle(
    deadLink
      ? view === "wrongEmail"
        ? t("auth.invite.wrongEmailTitle")
        : t("auth.invite.expiredTitle")
      : party
        ? t("portal.invite.title")
        : t("auth.invite.genericTitle"),
  );
  const home = me.data ? homeTarget(me.data as Me) : null;

  if (deadLink) {
    const expired = view !== "wrongEmail";
    return (
      <AuthFrame brand>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 ref={heading} tabIndex={-1} className="orrn-auth-title">
              {expired ? t("auth.invite.expiredTitle") : t("auth.invite.wrongEmailTitle")}
            </h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">
              {expired ? t("auth.invite.expired") : t("auth.invite.wrongEmail")}
            </p>
          </div>
          {!expired ? (
            <Button
              size="lg"
              className="w-full"
              onClick={useAnotherAccount}
            >
              {t("auth.signOut")}
            </Button>
          ) : home ? (
            // Already signed in: /login would only show them the form again.
            <Button asChild size="lg" className="w-full">
              <Link to={home} replace>
                {t(HOME_LABEL[home])}
              </Link>
            </Button>
          ) : (
            <Button asChild size="lg" className="w-full">
              <Link to="/login">{t("auth.invite.goSignIn")}</Link>
            </Button>
          )}
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame brand>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 ref={heading} tabIndex={-1} className="orrn-auth-title">
            {party ? t("portal.invite.title") : t("auth.invite.genericTitle")}
          </h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            {signedInEmail ? t("auth.invite.signedInAs", { email: signedInEmail }) : party ? t("portal.invite.body") : t("auth.invite.genericBody")}
          </p>
        </div>

        {view === "failed" ? (
          <div className="flex flex-col gap-3">
            <FormAlert>
              {(status.error as { data?: { code?: unknown } | null } | null)?.data?.code === "TOO_MANY_REQUESTS"
                ? t("auth.errors.tooMany")
                : t("errors.generic")}
            </FormAlert>
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                if (meFailed) void me.refetch();
                if (status.isError) void status.refetch();
              }}
            >
              {t("common.retry")}
            </Button>
          </div>
        ) : view === "loading" ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-5">
            <span className="sr-only">{t("common.loading")}</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-11 w-full pointer-coarse:h-12" />
              </div>
            ))}
            <Skeleton className="h-14 w-full rounded-full" />
          </div>
        ) : view === "join" ? (
          <div className="flex flex-col gap-3">
            {acceptError ? <FormAlert>{t(acceptError)}</FormAlert> : null}
            <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => void acceptInvite()}>
              {accept.isPending ? t("auth.invite.submitting") : t("auth.invite.joinAsMe")}
            </Button>
            <Button size="lg" variant="secondary" className="w-full" disabled={accept.isPending} onClick={useAnotherAccount}>
              {t("auth.invite.otherAccount")}
            </Button>
          </div>
        ) : view === "signIn" ? (
          <div className="flex flex-col gap-5">
            <FormAlert tone="blue">{t("auth.invite.existingAccount")}</FormAlert>
            {acceptError ? <FormAlert>{t(acceptError)}</FormAlert> : null}
            <SignInForm
              heading={false}
              defaultEmail={signInEmail}
              next={invitePath(token, party)}
              alternatives
              submitLabel={t("auth.invite.signInSubmit")}
              onSignedIn={() => acceptInvite()}
            />
          </div>
        ) : view === "noPassword" ? (
          <NoPasswordView token={token} next={invitePath(token, party)} acceptError={acceptError} onSignedIn={() => acceptInvite()} />
        ) : (
          <div className="flex flex-col gap-6">
            <CreateAccountForm
              inviteToken={token}
              acceptError={acceptError}
              onExpired={() => setLearned("expired")}
              onExisting={(email) => {
                setSignInEmail(email);
                setLearned("signIn");
              }}
              onCreated={(name) => acceptInvite(name)}
            />
            {live?.google ? <CreateWithGoogle next={invitePath(token, party)} /> : null}
          </div>
        )}
      </div>
    </AuthFrame>
  );
}

/** This invite page's own path, the way back after Google or an emailed password link. */
function invitePath(token: string, party: boolean): string {
  return `/invite/${encodeURIComponent(token)}${party ? "?kind=portal" : ""}`;
}

/**
 * "Continue with Google" under the create form. Google makes the account only for an email with a
 * live invite and accepts its invites as it does (google-guard.ts); it comes back to this page, where
 * Join finishes. No passkey here: there is no account to hold one yet.
 */
function CreateWithGoogle({ next }: { next: string }) {
  const [error, setError] = useState<MessageKey | null>(null);
  return <AltSignIn next={next} passkey={false} finish={async () => {}} error={error} onError={setError} />;
}

/**
 * The invited email has an account with no password (a magic-link approval, or Google or a passkey
 * only). It may already have a passkey or Google, so those come first where they can work; then
 * "Email me a link to set a password", sent only to the invite's own email (`invite.sendSetPasswordLink`)
 * and returning here, where the person signs in with the new password and joins. The answer never says
 * whether the typed email was the invite's.
 */
function NoPasswordView({
  token,
  next,
  acceptError,
  onSignedIn,
}: {
  token: string;
  next: string;
  acceptError: MessageKey | null;
  onSignedIn(): Promise<void>;
}) {
  const { t } = useT();
  const buttons = useAltSignInButtons();
  const [altError, setAltError] = useState<MessageKey | null>(null);
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<MessageKey | null>(null);
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [sent, setSent] = useState(false);
  const send = useMutation(trpc.invite.sendSetPasswordLink.mutationOptions({ meta: INLINE_ERROR_META }));
  const emailRef = useRef<HTMLInputElement>(null);
  const sentRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (sent) sentRef.current?.focus();
  }, [sent]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    setFormError(null);
    if (!trimmed || !EMAIL.test(trimmed)) {
      setEmailError(trimmed ? "errors.invalidEmail" : "auth.validation.email");
      return emailRef.current?.focus();
    }
    setEmailError(null);
    try {
      await send.mutateAsync({ token, email: trimmed });
      setSent(true);
    } catch (error) {
      const code = (error as { data?: { code?: unknown } | null }).data?.code;
      setFormError(code === "TOO_MANY_REQUESTS" ? "auth.errors.tooMany" : "auth.forgot.failed");
    }
  }

  const anyButton = buttons.passkey || buttons.google;

  return (
    <div className="flex flex-col gap-5" data-testid="invite-no-password">
      <FormAlert tone="blue">
        <span className="font-semibold">{t("auth.invite.noPasswordTitle")}</span> {t("auth.invite.noPasswordBody")}
      </FormAlert>
      {acceptError ? <FormAlert>{t(acceptError)}</FormAlert> : null}
      {anyButton ? <AltSignIn next={next} divider={false} finish={onSignedIn} error={altError} onError={setAltError} /> : null}
      {anyButton ? <OrLine /> : null}
      {sent ? (
        <p ref={sentRef} tabIndex={-1} role="status" data-testid="set-password-sent" className="m-0 text-[15px] leading-6 text-foreground outline-none">
          {t("auth.invite.setPasswordSent")}
        </p>
      ) : (
        <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" aria-busy={send.isPending || undefined}>
          <div className="flex flex-col gap-1">
            <h2 className="m-0 text-[17px] font-semibold">{t("auth.invite.setPasswordLead")}</h2>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("auth.invite.setPasswordHint")}</p>
          </div>
          <Field label={t("auth.invite.email")} error={emailError ? t(emailError) : undefined}>
            <TextInput
              ref={emailRef}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={320}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              data-testid="set-password-email"
            />
          </Field>
          {formError ? <FormAlert>{t(formError)}</FormAlert> : null}
          <Button type="submit" size="lg" variant={anyButton ? "secondary" : "primary"} className="w-full" loading={send.isPending} data-testid="set-password-submit">
            {send.isPending ? t("auth.invite.setPasswordSending") : t("auth.invite.setPasswordSubmit")}
          </Button>
        </form>
      )}
    </div>
  );
}

type CreateErrors = Partial<Record<"name" | "email" | "password", MessageKey>>;

function CreateAccountForm({
  inviteToken,
  acceptError,
  onExpired,
  onExisting,
  onCreated,
}: {
  /** The server makes an account only for the invited email, from a live invite (sign-up-guard.ts). */
  inviteToken: string;
  acceptError: MessageKey | null;
  /** The invite died while the form was open (expired, used or revoked). */
  onExpired(): void;
  onExisting(email: string): void;
  onCreated(name: string): Promise<void>;
}) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<CreateErrors>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const next: CreateErrors = {};
    if (!trimmedName) next.name = "auth.validation.name";
    if (!trimmedEmail) next.email = "auth.validation.email";
    else if (!EMAIL.test(trimmedEmail)) next.email = "errors.invalidEmail";
    if (password.length < 8) next.password = "auth.validation.passwordShort";
    setErrors(next);
    setFormError(null);
    if (next.name) return nameRef.current?.focus();
    if (next.email) return emailRef.current?.focus();
    if (next.password) return passwordRef.current?.focus();

    setPending(true);
    try {
      // `inviteToken` is read by the server's invite check (packages/auth/src/sign-up-guard.ts); Better
      // Auth's client types list only its own fields, so the body is a named object, not a literal.
      const body = { name: trimmedName, email: trimmedEmail, password, inviteToken };
      const { error } = await authClient.signUp.email(body);
      if (error) {
        if (isExistingAccount(error)) return onExisting(trimmedEmail);
        const refused = inviteSignUpRefusal(error);
        if (refused === "expired") return onExpired();
        if (refused === "wrongEmail") {
          setErrors({ email: "auth.invite.wrongEmailTitle" });
          return emailRef.current?.focus();
        }
        if (error.code === "PASSWORD_TOO_SHORT") {
          setErrors({ password: "auth.validation.passwordShort" });
          return passwordRef.current?.focus();
        }
        if (error.code === "INVALID_EMAIL") {
          setErrors({ email: "errors.invalidEmail" });
          return emailRef.current?.focus();
        }
        const key = signInErrorKey(error);
        setFormError(key === "auth.login.wrongCredentials" ? "errors.generic" : key);
        return;
      }
      await onCreated(trimmedName);
    } catch (error) {
      setFormError(signInErrorKey(error as Error));
    } finally {
      setPending(false);
    }
  }

  const shownError = formError ?? acceptError;

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-busy={pending || undefined}>
      <Field label={t("auth.invite.name")} error={errors.name && t(errors.name)}>
        <TextInput
          ref={nameRef}
          autoComplete="name"
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
        />
      </Field>
      <Field label={t("auth.invite.email")} error={errors.email && t(errors.email)}>
        <TextInput
          ref={emailRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={320}
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
        />
      </Field>
      <PasswordField
        ref={passwordRef}
        label={t("auth.invite.password")}
        hint={errors.password ? undefined : t("auth.invite.passwordHint")}
        autoComplete="new-password"
        value={password}
        onValueChange={setPassword}
        error={errors.password && t(errors.password)}
      />
      {shownError ? <FormAlert>{t(shownError)}</FormAlert> : null}
      <Button type="submit" size="lg" loading={pending} className="w-full">
        {pending ? t("auth.invite.submitting") : t("auth.invite.submit")}
      </Button>
    </form>
  );
}
