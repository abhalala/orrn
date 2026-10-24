import { Field, TextInput } from "@orrn/ui/components/field";
import { forwardRef } from "react";

export type CodeFieldProps = {
  label: string;
  value: string;
  onValueChange(value: string): void;
  /** Called once the sixth digit lands, so the person doesn't have to find the button. */
  onComplete?(code: string): void;
  error?: string;
  hint?: string;
  disabled?: boolean;
  id?: string;
  /** Id of text elsewhere on the screen that explains the code (read with the field). */
  describedBy?: string;
};

/**
 * One field for a 6-digit authenticator code: big mono digits, numeric
 * keypad, the OS one-time-code autofill, paste of "123 456" or "123-456"
 * keeps only the digits. One input (not six boxes) so screen readers, paste
 * and autofill all just work.
 */
export const CodeField = forwardRef<HTMLInputElement, CodeFieldProps>(function CodeField(
  { label, value, onValueChange, onComplete, error, hint, disabled, id, describedBy },
  ref,
) {
  return (
    <Field label={label} error={error} hint={hint} id={id}>
      <TextInput
        ref={ref}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        spellCheck={false}
        aria-describedby={describedBy}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const digits = e.currentTarget.value.replace(/\D/g, "").slice(0, 6);
          onValueChange(digits);
          if (digits.length === 6 && digits !== value) onComplete?.(digits);
        }}
        className="h-14 text-center font-mono text-[28px] font-semibold tabular-nums tracking-[0.3em] pointer-coarse:h-14 pointer-coarse:text-[28px]"
      />
    </Field>
  );
});
