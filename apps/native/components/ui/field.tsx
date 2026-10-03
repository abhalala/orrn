import { cn } from "@orrn/ui/lib/utils";
import { forwardRef, useId } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useThemeColor } from "@/lib/theme";

export type FieldProps = Omit<TextInputProps, "style"> & {
  /** Visible label above the input (never placeholder-as-label). */
  label: string;
  /** Helper text under the input. */
  hint?: string;
  /** Error text; replaces the hint, marks the field invalid and is read with the label. */
  error?: string | null;
  /** Numbers, serials, codes: Geist Mono. */
  mono?: boolean;
  className?: string;
  inputClassName?: string;
};

/**
 * Labelled text field, 56px tall for gloved fingers. React Native has no
 * `aria-describedby`, so the error and hint are folded into the input's
 * accessible label and hint: VoiceOver/TalkBack read "Email, Enter an email
 * like name@company.com" on focus.
 */
export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, hint, error, mono, className, inputClassName, editable = true, ...rest },
  ref,
) {
  const id = useId();
  const placeholderColor = useThemeColor("muted-foreground");
  const message = error || hint;

  return (
    <View className={cn("gap-1.5", className)}>
      <Text nativeID={`${id}-label`} className="font-sans-medium text-sm text-ink">
        {label}
      </Text>
      <TextInput
        ref={ref}
        accessibilityLabel={error ? `${label}, ${error}` : label}
        accessibilityHint={!error && hint ? hint : undefined}
        accessibilityLabelledBy={`${id}-label`}
        accessibilityState={{ disabled: !editable }}
        aria-invalid={!!error}
        editable={editable}
        placeholderTextColor={placeholderColor}
        className={cn(
          "min-h-14 rounded-input border bg-surface px-4 text-base text-ink",
          mono ? "font-mono" : "font-sans",
          error ? "border-destructive" : "border-control",
          !editable && "opacity-60",
          inputClassName,
        )}
        {...rest}
      />
      {message ? (
        <Text
          className={cn("font-sans text-sm", error ? "text-destructive" : "text-ink-muted")}
          accessibilityLiveRegion={error ? "polite" : "none"}
          importantForAccessibility={error ? "yes" : "no"}
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
});
