import { useT } from "@orrn/i18n";
import { Field, TextInput } from "@orrn/ui/components/field";
import { Eye, EyeOff } from "lucide-react";
import { forwardRef, useState } from "react";

export type PasswordFieldProps = {
  label: string;
  value: string;
  onValueChange(value: string): void;
  autoComplete: "current-password" | "new-password";
  hint?: string;
  error?: string;
  /** Mark the field invalid when the error is shown elsewhere (the sign-in alert). */
  invalid?: boolean;
  id?: string;
  name?: string;
  disabled?: boolean;
};

/**
 * Password input with a show/hide toggle (gloves and small phone keyboards
 * make typos likely). The toggle is a real button inside the field, 44px on
 * touch; showing the password never submits. It is a toggle button in the
 * APG sense: a fixed name ("Show password") with `aria-pressed` carrying the
 * state, so screen readers don't hear the state twice.
 */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, value, onValueChange, autoComplete, hint, error, invalid, id, name, disabled },
  ref,
) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <Field label={label} hint={hint} error={error} id={id}>
      <div className="relative min-w-0">
        <TextInput
          ref={ref}
          name={name}
          type={shown ? "text" : "password"}
          autoComplete={autoComplete}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          disabled={disabled}
          onChange={(e) => onValueChange(e.currentTarget.value)}
          aria-invalid={invalid || undefined}
          className="pr-12"
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={t("auth.login.showPassword")}
          title={t("auth.login.showPassword")}
          disabled={disabled}
          className="animate-press absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:text-foreground disabled:opacity-50"
        >
          {shown ? (
            <EyeOff aria-hidden="true" className="size-[18px]" strokeWidth={2} />
          ) : (
            <Eye aria-hidden="true" className="size-[18px]" strokeWidth={2} />
          )}
        </button>
      </div>
    </Field>
  );
});
