import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { FormAlert } from "@/features/auth/form-alert";
import { newPasswordError, parseResetSearch, resetLinkBroken, type ResetSearch } from "@/features/auth/password-reset";
import { PasswordField } from "@/features/auth/password-field";
import { authClient } from "@/shared/lib/auth-client";

export const Route = createFileRoute("/_public/reset-password")({
  component: ResetPasswordPage,
  // Plain check (no zod): route options sit in the entry chunk every page loads.
  validateSearch: (search: Record<string, unknown>): ResetSearch => parseResetSearch(search),
});

type Phase = "form" | "done" | "refused";

/**
 * Landing page of the reset email: Better Auth has checked the token and sent the person here with
 * `?token=` (or `?error=INVALID_TOKEN`). They choose a new password; every session of that account
 * is signed out, and the authenticator code is still asked for at the next sign-in.
 */
function ResetPasswordPage() {
  const { t } = useT();
  const search = Route.useSearch();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<ReturnType<typeof newPasswordError>>(null);
  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [failed, setFailed] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const problem = newPasswordError(password, confirm);
    setError(problem);
    if (problem || !search.token) return;
    setPending(true);
    setFailed(false);
    try {
      const { error: failure } = await authClient.resetPassword({ newPassword: password, token: search.token });
      if (failure) {
        // The token was used, expired, or the password was refused: a dead token cannot be retried.
        if (failure.status === 400 && /token/i.test(`${failure.code ?? ""} ${failure.message ?? ""}`)) setPhase("refused");
        else setFailed(true);
        return;
      }
      setPhase("done");
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  }

  if (phase === "done") {
    return (
      <AuthFrame brand>
        <div className="flex flex-col gap-6" data-testid="reset-done">
          <div className="flex flex-col gap-2">
            <h1 className="orrn-auth-title">{t("auth.reset.doneTitle")}</h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground" role="status">
              {t("auth.reset.doneBody")}
            </p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link to="/login">{t("auth.reset.goSignIn")}</Link>
          </Button>
        </div>
      </AuthFrame>
    );
  }

  if (phase === "refused" || resetLinkBroken(search)) {
    return (
      <AuthFrame brand>
        <div className="flex flex-col gap-6" data-testid="reset-broken">
          <div className="flex flex-col gap-2">
            <h1 className="orrn-auth-title">{t("auth.reset.badTitle")}</h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("auth.reset.badBody")}</p>
          </div>
          <Button asChild size="lg" className="w-full">
            <Link to="/forgot-password">{t("auth.reset.askAgain")}</Link>
          </Button>
        </div>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame brand>
      <form noValidate onSubmit={submit} className="flex flex-col gap-6" aria-busy={pending || undefined}>
        <div className="flex flex-col gap-2">
          <h1 className="orrn-auth-title">{t("auth.reset.title")}</h1>
          <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("auth.reset.body")}</p>
        </div>
        <PasswordField
          label={t("auth.reset.password")}
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
          error={error === "auth.validation.passwordShort" ? t(error) : undefined}
        />
        <PasswordField
          label={t("auth.reset.confirm")}
          autoComplete="new-password"
          value={confirm}
          onValueChange={setConfirm}
          error={error === "auth.reset.mismatch" ? t(error) : undefined}
        />
        {failed ? <FormAlert>{t("auth.reset.failed")}</FormAlert> : null}
        <Button type="submit" size="lg" className="w-full" loading={pending} data-testid="reset-submit">
          {pending ? t("auth.reset.saving") : t("auth.reset.submit")}
        </Button>
      </form>
    </AuthFrame>
  );
}
