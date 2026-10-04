import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from "react";

import { queryClient, trpc } from "@/shared/utils/trpc";

import { FormAlert } from "../form-alert";
import { PasswordField } from "../password-field";
import { StepHeading } from "./step-heading";

function trpcCode(error: unknown): unknown {
  return error && typeof error === "object" ? (error as { data?: { code?: unknown } | null }).data?.code : undefined;
}

/**
 * Set a password. `forced`: a temp-password account rotating it
 * (`auth.changeInitialPassword`, which also signs out every other session).
 * Otherwise the first password of an account that has none (`auth.setPassword`).
 * The stepper only offers that while `auth.me` says there is no password, so
 * a CONFLICT means another tab set one meanwhile: we keep it, say so on this
 * step (not in a toast that is easy to miss) and let them continue.
 *
 * `onDone` gets the new password so the two-factor step can use it without
 * asking again (it stays in memory only), or null when none was set here.
 */
export function PasswordStep({
  forced,
  onDone,
  headingRef,
}: {
  forced: boolean;
  onDone(password: string | null): void;
  headingRef?: Ref<HTMLHeadingElement>;
}) {
  const { t } = useT();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<{ password?: MessageKey; confirm?: MessageKey }>({});
  const [failed, setFailed] = useState(false);
  const [kept, setKept] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const keptId = useId();

  useEffect(() => {
    if (kept) continueRef.current?.focus();
  }, [kept]);

  const change = useMutation(trpc.auth.changeInitialPassword.mutationOptions());
  const setFirst = useMutation(trpc.auth.setPassword.mutationOptions());
  const pending = change.isPending || setFirst.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (pending) return;
    const next: typeof errors = {};
    if (password.length < 8) next.password = "auth.validation.passwordShort";
    else if (confirm !== password) next.confirm = "welcome.password.mismatch";
    setErrors(next);
    setFailed(false);
    if (next.password) return passwordRef.current?.focus();
    if (next.confirm) return confirmRef.current?.focus();

    try {
      if (forced) await change.mutateAsync({ newPassword: password });
      else await setFirst.mutateAsync({ password });
    } catch (error) {
      if (!forced && trpcCode(error) === "CONFLICT") {
        setKept(true);
        void queryClient.invalidateQueries(trpc.auth.me.queryFilter());
        return;
      }
      setFailed(true);
      return;
    }
    await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
    // No toast: the stepper's tick and the next step's heading (which takes focus) say it.
    onDone(password);
  }

  if (kept) {
    return (
      <div className="flex flex-col gap-6">
        <StepHeading headingRef={headingRef} title={t("welcome.password.title")} body={t("welcome.password.body")} />
        <FormAlert tone="blue" id={keptId}>
          {t("welcome.password.alreadySet")}
        </FormAlert>
        <Button ref={continueRef} size="lg" className="w-full" aria-describedby={keptId} onClick={() => onDone(null)}>
          {t("common.continue")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        headingRef={headingRef}
        title={t("welcome.password.title")}
        body={forced ? t("welcome.password.forcedBody") : t("welcome.password.body")}
      />
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-busy={pending || undefined}>
        <PasswordField
          ref={passwordRef}
          label={t("welcome.password.newPassword")}
          // The error repeats the rule, so the hint steps aside while it shows.
          hint={errors.password ? undefined : t("welcome.password.hint")}
          autoComplete="new-password"
          value={password}
          onValueChange={setPassword}
          error={errors.password && t(errors.password)}
        />
        <PasswordField
          ref={confirmRef}
          label={t("welcome.password.confirmPassword")}
          autoComplete="new-password"
          value={confirm}
          onValueChange={setConfirm}
          error={errors.confirm && t(errors.confirm)}
        />
        {failed ? <FormAlert>{t("errors.generic")}</FormAlert> : null}
        <Button type="submit" size="lg" loading={pending} className="w-full">
          {pending ? t("welcome.password.submitting") : t("welcome.password.submit")}
        </Button>
      </form>
    </div>
  );
}
