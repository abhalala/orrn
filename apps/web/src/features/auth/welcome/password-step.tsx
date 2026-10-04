import { useT, type MessageKey } from "@orrn/i18n";
import { Button } from "@orrn/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type Ref } from "react";
import { toast } from "sonner";

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
 * Otherwise the first password of a magic-link owner (`auth.setPassword`); if
 * the account already has one (CONFLICT) we keep it and move on.
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
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

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
        toast.info(t("welcome.password.alreadySet"));
        onDone(null);
        return;
      }
      setFailed(true);
      return;
    }
    await queryClient.invalidateQueries(trpc.auth.me.queryFilter());
    toast.success(t("welcome.password.saved"));
    onDone(password);
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
          hint={t("welcome.password.hint")}
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
