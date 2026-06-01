import {
  forwardRef,
  type ChangeEvent,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

import { cn } from "@orrn/ui/lib/utils";

const inputBase =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 file:border-0 file:bg-transparent file:text-sm file:font-medium";

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
        "flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
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
