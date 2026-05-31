import { forwardRef, type ChangeEvent, type ReactNode } from "react";

import { Input as TgInput, TextArea as TgTextArea } from "@orrn/ui/lib/tg";

/**
 * Cross-platform Tamagui input with backwards-compatible `onChange` handling
 * for the existing web screens (which pass `onChange={(e) => setX(e.target.value)}`).
 * New code should prefer `onChangeText`.
 */
type OnChange = (e: ChangeEvent<HTMLInputElement>) => void;
type OnChangeText = (text: string) => void;

/**
 * Style passthrough props commonly used by callers. Tamagui accepts many
 * more; for those, cast props to `any` at the call site. This intentionally
 * narrow surface keeps `onChange` typed precisely.
 */
type StyleBag = {
  className?: string;
  width?: number | string;
  maxWidth?: number | string;
  minWidth?: number | string;
  flex?: number;
  height?: number | string;
  paddingLeft?: number;
  paddingRight?: number;
  paddingHorizontal?: number;
  fontSize?: number;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  autoCorrect?: boolean;
  ref?: any;
  id?: string;
  name?: string;
  required?: boolean;
  step?: string | number;
  min?: string | number;
  max?: string | number;
  rows?: number;
  multiline?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  readOnly?: boolean;
  onBlur?: (e: any) => void;
  onFocus?: (e: any) => void;
  onKeyDown?: (e: any) => void;
  onSubmit?: (e: any) => void;
  onSubmitEditing?: (e: any) => void;
  autoComplete?: string;
  spellCheck?: boolean;
};

export type InputProps = StyleBag & {
  onChange?: OnChange;
  onChangeText?: OnChangeText;
  type?: string;
  children?: ReactNode;
  value?: string | number;
  defaultValue?: string | number;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  secureTextEntry?: boolean;
  inputMode?: "text" | "email" | "tel" | "url" | "numeric" | "decimal" | "search" | "none";
};

export const Input = forwardRef<unknown, InputProps>(function Input(props, ref) {
  const { onChange, onChangeText, type, secureTextEntry, ...rest } = props;
  return (
    <TgInput
      ref={ref as any}
      borderRadius={8}
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$backgroundStrong"
      paddingHorizontal={12}
      height={36}
      fontSize={13}
      focusStyle={{ borderColor: "$primary", outlineWidth: 0 }}
      secureTextEntry={secureTextEntry ?? type === "password"}
      type={type}
      onChangeText={(text: string) => {
        onChangeText?.(text);
        if (onChange) {
          onChange({ target: { value: text } } as unknown as ChangeEvent<HTMLInputElement>);
        }
      }}
      {...(rest as any)}
    />
  );
});

type OnChangeArea = (e: ChangeEvent<HTMLTextAreaElement>) => void;

export type TextAreaProps = StyleBag & {
  onChange?: OnChangeArea;
  onChangeText?: OnChangeText;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
};

export const TextArea = forwardRef<unknown, TextAreaProps>(function TextArea(props, ref) {
  const { onChange, onChangeText, ...rest } = props;
  return (
    <TgTextArea
      ref={ref as any}
      borderRadius={8}
      borderWidth={1}
      borderColor="$borderColor"
      backgroundColor="$backgroundStrong"
      paddingHorizontal={12}
      paddingVertical={10}
      fontSize={13}
      focusStyle={{ borderColor: "$primary", outlineWidth: 0 }}
      onChangeText={(text: string) => {
        onChangeText?.(text);
        if (onChange) {
          onChange({ target: { value: text } } as unknown as ChangeEvent<HTMLTextAreaElement>);
        }
      }}
      {...(rest as any)}
    />
  );
});
