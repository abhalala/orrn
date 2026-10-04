import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { authClient } from "@/shared/lib/auth-client";

import { signInErrorKey, totpErrorKey } from "./auth-errors";
import { CodeField } from "./code-field";
import { FormAlert } from "./form-alert";
import { PasswordField } from "./password-field";
import { useFinishSignIn } from "./use-finish-sign-in";

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "password" | "totp" | "backup";

export type SignInFormProps = {
  /** Page to return to after sign-in (same-origin only, see `safeNext`). */
  next?: string;
  defaultEmail?: string;
  /** Replaces the default "go home" once signed in (the invite page accepts the invite). */
  onSignedIn?: () => Promise<void>;
  /** Render the screen's h1. Off when the page owns its heading (invite). */
  heading?: boolean;
  /** Label of the password-step button. Default "Sign in". */
  submitLabel?: string;
  /** Shown under the password step (the "New to orrn?" line). */
  footer?: ReactNode;
};

/**
 * Email + password, then the authenticator code when the account has
 * two-factor (or a backup code). Errors are inline and announced; nothing
 * here is a toast. Enter submits every step; the sixth digit submits the code.
 */
export function SignInForm({ next, defaultEmail = "", onSignedIn, heading = true, submitLabel, footer }: SignInFormProps) {
  const { t } = useT();
  const finishSignIn = useFinishSignIn(next);
  const finish = onSignedIn ?? finishSignIn;

  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [backupCode, setBackupCode] = useState("");
  const [trust, setTrust] = useState(true);
  // Message keys, not text: errors already shown follow a language switch.
  const [fieldErrors, setFieldErrors] = useState<{ email?: MessageKey; password?: MessageKey; code?: MessageKey }>({});
  const [formError, setFormError] = useState<MessageKey | null>(null);
  const [pending, setPending] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const bodyId = useId();
  const firstRender = useRef(true);

  // Each step change puts the keyboard where the next thing is typed.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (mode === "password") passwordRef.current?.focus();
    else codeRef.current?.focus();
  }, [mode]);

  const switchMode = (to: Mode) => {
    setMode(to);
    setFieldErrors({});
    setFormError(null);
    setCode("");
    setBackupCode("");
  };

  async function submitPassword() {
    const errors: typeof fieldErrors = {};
    const trimmed = email.trim();
    if (!trimmed) errors.email = "auth.validation.email";
    else if (!EMAIL.test(trimmed)) errors.email = "errors.invalidEmail";
    if (!password) errors.password = "auth.validation.password";
    setFieldErrors(errors);
    setFormError(null);
    if (errors.email) return emailRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setPending(true);
    try {
      const { data, error } = await authClient.signIn.email({ email: trimmed, password });
      if (error) {
        setFormError(signInErrorKey(error));
        passwordRef.current?.select();
        return;
      }
      if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
        switchMode("totp");
        return;
      }
      await finish();
    } catch (error) {
      setFormError(signInErrorKey(error as Error));
    } finally {
      setPending(false);
    }
  }

  async function submitCode(value = mode === "backup" ? backupCode.trim() : code) {
    if (pending) return;
    if (mode === "totp" && value.length !== 6) {
      setFieldErrors({ code: "auth.totp.codeRequired" });
      return codeRef.current?.focus();
    }
    if (mode === "backup" && !value) {
      setFieldErrors({ code: "auth.totp.backupRequired" });
      return codeRef.current?.focus();
    }
    setFieldErrors({});
    setFormError(null);
    setPending(true);
    try {
      const { error } =
        mode === "backup"
          ? await authClient.twoFactor.verifyBackupCode({ code: value, trustDevice: trust })
          : await authClient.twoFactor.verifyTotp({ code: value, trustDevice: trust });
      if (error) {
        const key = totpErrorKey(error);
        if (key === "auth.errors.twoFactorExpired") {
          // The short-lived two-factor sign-in ran out: start again from the password.
          setPassword("");
          switchMode("password");
          setFormError(key);
          return;
        }
        setFieldErrors({ code: mode === "backup" && key === "auth.totp.wrongCode" ? "auth.totp.wrongBackup" : key });
        if (mode === "totp") setCode("");
        codeRef.current?.focus();
        return;
      }
      await finish();
    } catch (error) {
      setFormError(totpErrorKey(error as Error));
    } finally {
      setPending(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "password") void submitPassword();
    else void submitCode();
  };

  const credentialsWrong = formError === "auth.login.wrongCredentials";

  return (
    <div data-slot="sign-in-form" className="flex w-full min-w-0 flex-col gap-6">
      {heading ? (
        <div className="flex flex-col gap-2">
          <h1 className="orrn-auth-title">
            {mode === "password" ? t("auth.login.title") : mode === "totp" ? t("auth.totp.title") : t("auth.totp.backupTitle")}
          </h1>
          <p id={bodyId} className="m-0 text-[15px] leading-6 text-muted-foreground">
            {mode === "password" ? t("auth.login.subtitle") : mode === "totp" ? t("auth.totp.body") : t("auth.totp.backupBody")}
          </p>
        </div>
      ) : mode !== "password" ? (
        <p id={bodyId} className="m-0 text-[15px] leading-6 text-muted-foreground">
          {mode === "totp" ? t("auth.totp.body") : t("auth.totp.backupBody")}
        </p>
      ) : null}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        {mode === "password" ? (
          <>
            <Field label={t("auth.login.email")} error={fieldErrors.email && t(fieldErrors.email)}>
              <TextInput
                ref={emailRef}
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                aria-invalid={credentialsWrong || undefined}
                onChange={(e) => setEmail(e.currentTarget.value)}
              />
            </Field>
            <PasswordField
              ref={passwordRef}
              name="password"
              label={t("auth.login.password")}
              autoComplete="current-password"
              value={password}
              onValueChange={setPassword}
              error={fieldErrors.password && t(fieldErrors.password)}
            />
          </>
        ) : mode === "totp" ? (
          <CodeField
            ref={codeRef}
            label={t("auth.totp.code")}
            value={code}
            onValueChange={setCode}
            onComplete={(full) => void submitCode(full)}
            error={fieldErrors.code && t(fieldErrors.code)}
            describedBy={bodyId}
          />
        ) : (
          <Field label={t("auth.totp.backupCode")} error={fieldErrors.code && t(fieldErrors.code)}>
            <TextInput
              ref={codeRef}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={backupCode}
              aria-describedby={bodyId}
              onChange={(e) => setBackupCode(e.currentTarget.value)}
              className="font-mono text-[17px] tracking-[0.06em]"
            />
          </Field>
        )}

        {mode !== "password" ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[15px] leading-5 text-foreground">
            <input
              type="checkbox"
              checked={trust}
              onChange={(e) => setTrust(e.currentTarget.checked)}
              className="size-5 shrink-0 cursor-pointer accent-[var(--ink)]"
            />
            {t("auth.totp.trust")}
          </label>
        ) : null}

        {formError ? <FormAlert>{t(formError)}</FormAlert> : null}

        <Button type="submit" size="lg" loading={pending} className="w-full">
          {mode === "password"
            ? pending
              ? t("auth.login.submitting")
              : (submitLabel ?? t("auth.login.submit"))
            : pending
              ? t("auth.totp.verifying")
              : t("auth.totp.submit")}
        </Button>

        {mode !== "password" ? (
          <div className="flex flex-col items-stretch gap-1">
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full whitespace-normal py-2 text-center"
              onClick={() => switchMode(mode === "totp" ? "backup" : "totp")}
            >
              {mode === "totp" ? t("auth.totp.useBackup") : t("auth.totp.useApp")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full whitespace-normal py-2 text-center text-muted-foreground"
              onClick={() => {
                setPassword("");
                switchMode("password");
              }}
            >
              {t("auth.totp.back")}
            </Button>
          </div>
        ) : null}
      </form>

      {mode === "password" ? footer : null}
    </div>
  );
}
