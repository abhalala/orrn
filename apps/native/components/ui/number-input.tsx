import { cn } from "@orrn/ui/lib/utils";
import { forwardRef, useId } from "react";
import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useThemeColor } from "@/lib/theme";

export type NumberInputProps = Omit<TextInputProps, "style" | "keyboardType"> & {
  label: string;
  /** Unit shown inside the field's right edge ("kg", "ft"). Read as part of the label. */
  unit?: string;
  hint?: string;
  error?: string | null;
  /** Digits only (pieces, feet); otherwise a decimal pad (kg, inches). */
  integer?: boolean;
  className?: string;
};

/**
 * A big numeric field for the floor: 64px tall, mono digits, the right
 * keyboard (number pad for whole numbers, decimal pad otherwise) and the unit
 * inside the box. Parsing stays in the screen's pure helpers (features/pack/pack-math.ts):
 * the text is passed through untouched.
 */
export const NumberInput = forwardRef<TextInput, NumberInputProps>(function NumberInput(
  { label, unit, hint, error, integer = false, className, editable = true, ...rest },
  ref,
) {
  const id = useId();
  const placeholderColor = useThemeColor("muted-foreground");
  const message = error || hint;
  const spoken = unit ? `${label}, ${unit}` : label;

  return (
    <View className={cn("gap-1.5", className)}>
      <Text nativeID={`${id}-label`} className="font-sans-medium text-sm text-ink">
        {label}
      </Text>
      <View
        className={cn(
          "min-h-16 flex-row items-center rounded-input border bg-surface px-4",
          error ? "border-destructive" : "border-control",
          !editable && "opacity-60",
        )}
      >
        <TextInput
          ref={ref}
          accessibilityLabel={error ? `${spoken}, ${error}` : spoken}
          accessibilityHint={!error && hint ? hint : undefined}
          accessibilityState={{ disabled: !editable }}
          keyboardType={integer ? "number-pad" : "decimal-pad"}
          inputMode={integer ? "numeric" : "decimal"}
          editable={editable}
          placeholderTextColor={placeholderColor}
          className="min-h-16 flex-1 font-mono-medium text-2xl text-ink"
          {...rest}
        />
        {unit ? (
          <Text importantForAccessibility="no" className="pl-2 font-sans-semibold text-base text-ink-muted">
            {unit}
          </Text>
        ) : null}
      </View>
      {message ? (
        <Text className={cn("font-sans text-sm", error ? "text-destructive" : "text-ink-muted")} accessibilityLiveRegion={error ? "polite" : "none"}>
          {message}
        </Text>
      ) : null}
    </View>
  );
});
