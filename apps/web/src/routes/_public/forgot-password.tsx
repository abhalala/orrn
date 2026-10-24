import { useT } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { AuthFrame } from "@/features/auth/auth-frame";
import { FormAlert } from "@/features/auth/form-alert";
import { resetRedirectUrl } from "@/features/auth/password-reset";
import { authClient } from "@/shared/lib/auth-client";

export const Route = createFileRoute("/_public/forgot-password")({
  component: ForgotPasswordPage,
});

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Forgot password: one field, one neutral answer. The server says the same thing whether or not
 * the address has an account, and so does this page ("if an account exists ..."), so nobody can
 * use it to find out who has one. The link in the email works once, for an hour.
 */
function ForgotPasswordPage() {
  const { t } = useT();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<"invalid" | "failed" | null>(null);
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL.test(trimmed)) {
      setError("invalid");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const { error: failure } = await authClient.requestPasswordReset({
        email: trimmed,
        redirectTo: resetRedirectUrl(window.location.origin),
      });
      if (failure) {
        // A rate limit or a network failure is all the person can act on; an unknown address never errors.
        setError("failed");
        return;
      }
      setSentTo(trimmed);
    } catch {
      setError("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthFrame brand>
      {sentTo ? (
        <div className="flex flex-col gap-6" data-testid="forgot-sent">
          <div className="flex flex-col gap-2">
            <h1 className="orrn-auth-title">{t("auth.forgot.sentTitle")}</h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground" role="status">
              {t("auth.forgot.sentBody", { email: sentTo })}
            </p>
          </div>
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link to="/login">{t("auth.forgot.back")}</Link>
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={submit} className="flex flex-col gap-6" aria-busy={pending || undefined}>
          <div className="flex flex-col gap-2">
            <h1 className="orrn-auth-title">{t("auth.forgot.title")}</h1>
            <p className="m-0 text-[15px] leading-6 text-muted-foreground">{t("auth.forgot.body")}</p>
          </div>
          <Field label={t("auth.login.email")} error={error === "invalid" ? t("errors.invalidEmail") : undefined}>
            <TextInput
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              data-testid="forgot-email"
            />
          </Field>
          {error === "failed" ? <FormAlert>{t("auth.forgot.failed")}</FormAlert> : null}
          <div className="flex flex-col gap-3">
            <Button type="submit" size="lg" className="w-full" loading={pending} data-testid="forgot-submit">
              {pending ? t("auth.forgot.submitting") : t("auth.forgot.submit")}
            </Button>
            <Button asChild variant="ghost" size="lg" className="w-full">
              <Link to="/login">{t("auth.forgot.back")}</Link>
            </Button>
          </div>
        </form>
      )}
    </AuthFrame>
  );
}
