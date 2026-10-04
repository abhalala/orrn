import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Skeleton } from "@orrn/ui/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { inviteAcceptOutcome, isExistingAccount, signInErrorKey } from "@/features/auth/auth-errors";
import { AuthFrame } from "@/features/auth/auth-frame";
import { FormAlert } from "@/features/auth/form-alert";
import { PasswordField } from "@/features/auth/password-field";
import { SignInForm } from "@/features/auth/sign-in-form";
import { useFinishSignIn } from "@/features/auth/use-finish-sign-in";
import { authClient } from "@/shared/lib/auth-client";
import { signOutAndReset } from "@/shared/lib/sign-out";
import { queryClient, trpc } from "@/shared/utils/trpc";

export const Route = createFileRoute("/_public/invite/$token")({
  component: InvitePage,
});

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type View = "create" | "signIn" | "expired" | "wrongEmail";

/**
 * Accept an invite. The copy is generic: no procedure reads the invite before
 * it is accepted, so the token is only checked on accept (plan Task 17).
 *
 * - Signed in already: join with this account, or sign out and use another.
 * - New here: name, email, password, then join.
 * - The email already has an account (Better Auth
 *   `USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`, audit N4): switch to sign-in
 *   (with the authenticator step if they have one), then join.
 * After joining, the person goes home: the welcome steps if any remain.
 */
function InvitePage() {
  const { t } = useT();
  const { token } = Route.useParams();
  const me = useQuery({ ...trpc.auth.me.queryOptions(), retry: false });
  const [view, setView] = useState<View>("create");
  const [signInEmail, setSignInEmail] = useState("");
  const [acceptError, setAcceptError] = useState<MessageKey | null>(null);
  const finishSignIn = useFinishSignIn();
  const accept = useMutation(trpc.invite.acceptByToken.mutationOptions());
  const heading = useRef<HTMLHeadingElement>(null);
  const viewChanged = useRef(false);

  useEffect(() => {
    // A new view replaces the form: put focus on its heading so it is read out.
    if (viewChanged.current) heading.current?.focus();
    viewChanged.current = true;
  }, [view]);

  /** Never throws: failures switch the view or show an inline error. */
  async function acceptInvite(name?: string) {
    setAcceptError(null);
    try {
      await accept.mutateAsync({ token, name });
    } catch (error) {
      const outcome = inviteAcceptOutcome(error);
      if (outcome === "failed") {
        setAcceptError("errors.generic");
        // They may have just signed in (the sign-in view): re-read who is
        // signed in so the page offers "Join with this account" to retry.
        void queryClient.invalidateQueries(trpc.auth.me.queryFilter());
      } else setView(outcome);
      return;
    }
    toast.success(t("auth.invite.joined"));
    await finishSignIn();
  }

  const signedInEmail = me.data?.user.email;

  if (view === "expired" || view === "wrongEmail") {
    return (
      <AuthFrame brand>
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 ref={heading} tabIndex={-1} className="orrn-auth-title">
              {view === "expired" ? t("auth.invite.expiredTitle") : t("auth.invite.wrongEmailTitle")}
            </h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">
              {view === "expired" ? t("auth.invite.expired") : t("auth.invite.wrongEmail")}
            </p>
          </div>
          {view === "wrongEmail" ? (
            <Button
              size="lg"
              className="w-full"
              onClick={() => void signOutAndReset(() => setView("create"))}
            >
              {t("auth.signOut")}
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
            {t("auth.invite.genericTitle")}
          </h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">
            {signedInEmail ? t("auth.invite.signedInAs", { email: signedInEmail }) : t("auth.invite.genericBody")}
          </p>
        </div>

        {me.isPending ? (
          <div aria-busy="true" aria-label={t("common.loading")} className="flex flex-col gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-5 w-28" />
                <Skeleton className="h-11 w-full pointer-coarse:h-12" />
              </div>
            ))}
            <Skeleton className="h-14 w-full rounded-full" />
          </div>
        ) : signedInEmail ? (
          <div className="flex flex-col gap-3">
            {acceptError ? <FormAlert>{t(acceptError)}</FormAlert> : null}
            <Button size="lg" className="w-full" loading={accept.isPending} onClick={() => void acceptInvite()}>
              {accept.isPending ? t("auth.invite.submitting") : t("auth.invite.joinAsMe")}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="w-full"
              disabled={accept.isPending}
              onClick={() => void signOutAndReset(() => setView("create"))}
            >
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
              submitLabel={t("auth.invite.signInSubmit")}
              onSignedIn={() => acceptInvite()}
            />
          </div>
        ) : (
          <CreateAccountForm
            acceptError={acceptError}
            onExisting={(email) => {
              setSignInEmail(email);
              setView("signIn");
            }}
            onCreated={(name) => acceptInvite(name)}
          />
        )}
      </div>
    </AuthFrame>
  );
}

type CreateErrors = Partial<Record<"name" | "email" | "password", MessageKey>>;

function CreateAccountForm({
  acceptError,
  onExisting,
  onCreated,
}: {
  acceptError: MessageKey | null;
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
      const { error } = await authClient.signUp.email({ name: trimmedName, email: trimmedEmail, password });
      if (error) {
        if (isExistingAccount(error)) return onExisting(trimmedEmail);
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
        hint={t("auth.invite.passwordHint")}
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
