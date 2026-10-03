import {
  forwardRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@orrn/ui/lib/utils";

const inputBase =
  // C2 field: 48px tall on phones, 44px from sm, 12px radius, white surface, control-strength border
// (>= 3:1). 16px text on touch so iOS doesn't zoom. Focus = global ink ring
// plus an ink border.
  "flex h-12 w-full rounded-input sm:h-11 border border-input bg-card px-3.5 py-2 text-[15px] text-foreground transition-[border-color,box-shadow] duration-[var(--dur-fast)] placeholder:text-muted-foreground hover:border-foreground/70 focus-visible:border-foreground aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground";

type OnChangeText = (text: string) => void;

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onChangeText?: OnChangeText;
  /** Native parity — ignored on web. */
  secureTextEntry?: boolean;
  /** Native parity — ignored on web. */
  inputMode?: InputHTMLAttributes<HTMLInputElement>["inputMode"];
};

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, onChange, onChangeText, secureTextEntry, type, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      data-slot="input"
      type={type ?? (secureTextEntry ? "password" : undefined)}
      className={cn(inputBase, className)}
      onChange={(e) => {
        onChange?.(e);
        onChangeText?.(e.currentTarget.value);
      }}
      {...rest}
    />
  );
});

export type TextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> & {
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onChangeText?: OnChangeText;
};

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, onChange, onChangeText, rows = 4, ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      rows={rows}
      className={cn(
        "flex min-h-24 w-full rounded-input border border-input bg-card px-3.5 py-2.5 text-[15px] text-foreground transition-[border-color,box-shadow] duration-[var(--dur-fast)] placeholder:text-muted-foreground hover:border-foreground/70 focus-visible:border-foreground aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:text-base",
        className,
      )}
      onChange={(e) => {
        onChange?.(e);
        onChangeText?.(e.currentTarget.value);
      }}
      {...rest}
    />
  );
});
