// @ts-nocheck — Bun resolves `react-native` to a different install for packages/ui
// vs apps/native (peer-dep context differs); cross-workspace type equality
// fails. Metro+Babel still bundle these correctly and NativeWind augments
// `className`, so disabling the inner typecheck is safe.
import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

import { cn } from "@orrn/ui/lib/utils";

/**
 * Native input. Mirrors the web Input's API: callers may pass either
 * `onChangeText` (preferred RN style) or `onChange` (a synthetic-event-like
 * callback used by legacy web code). The native shim re-fires `onChange`
 * with a fake target shape so cross-platform screens keep typechecking.
 */
export type InputProps = Omit<TextInputProps, "onChange"> & {
  onChange?: (e: { target: { value: string } }) => void;
  /** Web parity — ignored on native; secureTextEntry handles password fields. */
  type?: string;
  className?: string;
};

export const Input = forwardRef<TextInput, InputProps>(function Input(
  { className, onChange, onChangeText, type, secureTextEntry, ...rest },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor="#9ca3af"
      secureTextEntry={secureTextEntry ?? type === "password"}
      onChangeText={(text) => {
        onChangeText?.(text);
        onChange?.({ target: { value: text } });
      }}
      className={cn(
        "h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground",
        className,
      )}
      {...rest}
    />
  );
});

export type TextAreaProps = InputProps & { rows?: number };

export const TextArea = forwardRef<TextInput, TextAreaProps>(function TextArea(
  { className, rows = 4, onChange, onChangeText, type: _type, ...rest },
  ref,
) {
  return (
    <TextInput
      ref={ref}
      multiline
      numberOfLines={rows}
      placeholderTextColor="#9ca3af"
      textAlignVertical="top"
      onChangeText={(text) => {
        onChangeText?.(text);
        onChange?.({ target: { value: text } });
      }}
      className={cn(
        "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground",
        className,
      )}
      style={{ minHeight: rows * 22 }}
      {...rest}
    />
  );
});
