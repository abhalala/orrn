import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { Field, TextInput } from "@orrn/ui/components/field";
import { startAuthentication, WebAuthnAbortService } from "@simplewebauthn/browser";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { authClient } from "@/shared/lib/auth-client";

import { AltSignIn } from "./alt-sign-in";
import { offersPasswordLink, signInErrorKey, totpErrorKey } from "./auth-errors";
import { CodeField } from "./code-field";
import { FormAlert } from "./form-alert";
import { startPasskeyAutofill } from "./passkey-autofill";
import { passkeySupport } from "./passkey-support";
import { PasswordField } from "./password-field";
import { resetRedirectUrl } from "./password-reset";
import { useFinishSignIn } from "./use-finish-sign-in";
import { usePageTitle } from "./use-page-title";

/** Loose shape check only; the server is the judge. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Mode = "password" | "totp" | "backup";

/** Server answers to a passkey the person picked from the email field's autofill (`@better-auth/passkey`). */
const AUTOFILL_PICK_FAILURES = new Set(["PASSKEY_NOT_FOUND", "AUTHENTICATION_FAILED", "CHALLENGE_NOT_FOUND", "UNABLE_TO_CREATE_SESSION"]);

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
  /**
   * Offer the passkey and Google buttons under the form, and saved passkeys in the email field's
   * autofill (plan 2026-11-18). The sign-in page turns it on.
   */
  alternatives?: boolean;
  /** A message to open with (the sign-in page's `?error=` after a refused Google sign-in). */
  initialError?: MessageKey | null;
};

/**
 * Email + password, then the authenticator code when the account has
 * two-factor (or a backup code). With `alternatives`, a passkey and Google sit
 * level with it under an "or", and the email field offers saved passkeys
 * (conditional mediation). A passkey or Google sign-in never asks for the code.
 * Errors are inline and announced; nothing here is a toast. Enter submits
 * every step; the sixth digit submits the code.
 */
export function SignInForm({
  next,
  defaultEmail = "",
  onSignedIn,
  heading = true,
  submitLabel,
  footer,
  alternatives = false,
  initialError = null,
}: SignInFormProps) {
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
  // Passkey and Google messages, shown under their buttons. The one the page opens with (a refused
  // Google sign-in) sits above the form instead, where a phone shows it without scrolling.
  const [altError, setAltError] = useState<MessageKey | null>(initialError);
  const [altErrorOnTop, setAltErrorOnTop] = useState(initialError !== null);
  // Bumped when a passkey button attempt fails, so the email field's autofill starts again.
  const [autofillRound, setAutofillRound] = useState(0);
  const [pending, setPending] = useState(false);
  // "Email me a link to set a password" under a failed password sign-in (plan 2026-11-18, Task 8).
  const [linkState, setLinkState] = useState<{ sentTo: string } | { error: MessageKey } | "sending" | null>(null);

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

  // Saved passkeys in the email field's autofill (conditional mediation), while the email step shows.
  // Aborted when the step changes or the page goes; a ceremony aborted that way, or by the passkey
  // button (which takes over the browser's one WebAuthn request), says nothing. `startPasskeyAutofill`
  // checks after the challenge request that the effect is still live, so a cleanup during that request
  // never leaves a browser request behind (council r1, B5).
  useEffect(() => {
    if (!alternatives || mode !== "password") return;
    return startPasskeyAutofill(
      {
        conditional: passkeySupport().conditional,
        fetchOptions: () => authClient.$fetch("/passkey/generate-authenticate-options", { method: "GET", throw: false }),
        start: (optionsJSON) => startAuthentication({ optionsJSON, useBrowserAutofill: true }),
        verify: (response) => authClient.$fetch("/passkey/verify-authentication", { method: "POST", body: { response }, throw: false }),
        signedIn: () => authClient.$store.notify("$sessionSignal"),
        cancel: () => WebAuthnAbortService.cancelCeremony(),
      },
      (result) => {
        if (result.kind === "signedIn") return void finish();
        // A passkey picked from the email field's list failed: say so up there, by the field. A failure
        // before anything was picked (the challenge request: offline, rate limit) says nothing here.
        if (AUTOFILL_PICK_FAILURES.has(result.error.code ?? "")) {
          setAltError(signInErrorKey(result.error));
          setAltErrorOnTop(true);
        }
      },
    );
    // `finish` is read when a passkey is picked; restarting the browser request for a new closure would
    // close the autofill under the person's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alternatives, mode, autofillRound]);

  /**
   * An account made by a magic-link approval (or Google or a passkey only) has no password, and Better
   * Auth answers it exactly like a wrong password. The emailed reset link sets one; the answer is the
   * same neutral one as Forgot password, so it never says whether the email has an account. The link
   * brings the person back to `next` (the invite page) after the reset.
   */
  async function emailPasswordLink() {
    const trimmed = email.trim();
    if (!EMAIL.test(trimmed)) {
      setFieldErrors({ email: trimmed ? "errors.invalidEmail" : "auth.validation.email" });
      return emailRef.current?.focus();
    }
    setLinkState("sending");
    try {
      const { error } = await authClient.requestPasswordReset({ email: trimmed, redirectTo: resetRedirectUrl(window.location.origin, next) });
      if (error) {
        setLinkState({ error: error.status === 429 ? "auth.errors.tooMany" : "auth.forgot.failed" });
        return;
      }
      setLinkState({ sentTo: trimmed });
    } catch {
      setLinkState({ error: "auth.forgot.failed" });
    }
  }

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
    setAltError(null);
    setLinkState(null);
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
  // The alert names neither field, so both point at it (WCAG 3.3.1, 1.3.1).
  const alertId = `${bodyId}-alert`;
  const stepTitle = mode === "password" ? t("auth.login.title") : mode === "totp" ? t("auth.totp.title") : t("auth.totp.backupTitle");
  usePageTitle(heading ? stepTitle : null);

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

      {altError && altErrorOnTop && mode === "password" ? (
        <FormAlert>
          <span data-testid="alt-sign-in-error">{t(altError)}</span>
        </FormAlert>
      ) : null}

      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        {mode === "password" ? (
          <>
            <Field label={t("auth.login.email")} error={fieldErrors.email && t(fieldErrors.email)}>
              <TextInput
                ref={emailRef}
                type="email"
                name="email"
                autoComplete={alternatives ? "username webauthn" : "username"}
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={email}
                aria-invalid={credentialsWrong || undefined}
                aria-describedby={credentialsWrong ? alertId : undefined}
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
              // The alert can't say which of the two is wrong, so both fields say so.
              invalid={credentialsWrong}
              describedBy={credentialsWrong ? alertId : undefined}
              error={fieldErrors.password && t(fieldErrors.password)}
            />
            <Link
              to="/forgot-password"
              search={next ? { next } : {}}
              data-testid="forgot-link"
              className="-mt-3 inline-flex min-h-11 w-fit items-center text-[15px] font-semibold text-foreground underline decoration-control underline-offset-4 hover:decoration-foreground"
            >
              {t("auth.login.forgot")}
            </Link>
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

        {formError ? <FormAlert id={alertId}>{t(formError)}</FormAlert> : null}
        {mode === "password" && offersPasswordLink(formError) ? (
          <div className="-mt-2 flex flex-col gap-2">
            {linkState && typeof linkState === "object" && "sentTo" in linkState ? (
              <p role="status" data-testid="password-link-sent" className="m-0 text-[15px] leading-6 text-muted-foreground">
                {t("auth.login.passwordLinkSent", { email: linkState.sentTo })}
              </p>
            ) : (
              <Button
                type="button"
                variant="ghost"
                className="h-auto min-h-11 w-full whitespace-normal py-2 text-center"
                loading={linkState === "sending"}
                data-testid="password-link"
                onClick={() => void emailPasswordLink()}
              >
                {linkState === "sending" ? t("auth.login.passwordLinkSending") : t("auth.login.passwordLink")}
              </Button>
            )}
            {linkState && typeof linkState === "object" && "error" in linkState ? <FormAlert>{t(linkState.error)}</FormAlert> : null}
          </div>
        ) : null}

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

      {alternatives && mode === "password" ? (
        <AltSignIn
          next={next}
          finish={finish}
          error={altErrorOnTop ? null : altError}
          onError={(key) => {
            setAltError(key);
            setAltErrorOnTop(false);
            if (key === null) setFormError(null);
          }}
          onPasskeyEnded={() => setAutofillRound((n) => n + 1)}
          disabled={pending}
        />
      ) : null}

      {mode === "password" ? footer : null}
    </div>
  );
}
