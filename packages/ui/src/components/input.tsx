import { forwardRef, type ChangeEvent, type ReactNode } from "react";

import { Input as TgInput, TextArea as TgTextArea } from "@orrn/ui/lib/tg";

/**
 * Cross-platform Tamagui input with backwards-compatible `onChange` handling
 * for the existing web screens (which pass `onChange={(e) => setX(e.target.value)}`).
 * New code should prefer `onChangeText`.
 */
export type InputProps = Record<string, any> & {
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
  onChangeText?: (text: string) => void;
  type?: string;
  className?: string;
  children?: ReactNode;
};

export const Input = forwardRef<unknown, InputProps>(function Input(
  { onChange, onChangeText, type, secureTextEntry, ...rest },
  ref,
) {
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
      {...rest}
    />
  );
});

export type TextAreaProps = Record<string, any> & {
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  onChangeText?: (text: string) => void;
};

export const TextArea = forwardRef<unknown, TextAreaProps>(function TextArea(
  { onChange, onChangeText, ...rest },
  ref,
) {
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
      {...rest}
    />
  );
});
