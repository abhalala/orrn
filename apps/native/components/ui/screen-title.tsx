import { cn } from "@orrn/ui/lib/utils";
import { Text, type TextProps } from "react-native";

const SIZES = {
  /** Screens without a native large title (sign-in, scan). */
  lg: "text-[34px] leading-[46px]",
  /** Full-screen messages (offline, no access). */
  md: "text-[30px] leading-[40px]",
} as const;

export type ScreenTitleProps = TextProps & { size?: keyof typeof SIZES; className?: string };

/**
 * The C2 display heading (Bricolage Grotesque, tight tracking) for screens
 * that draw their own title. The line height is 1.35x so Devanagari vowel
 * marks above the line are never clipped in Hindi (__tests__/type-scale.test.ts),
 * and Dynamic Type may grow it to 1.4x before the layout would break.
 */
export function ScreenTitle({ size = "lg", className, children, ...rest }: ScreenTitleProps) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={1.4}
      {...rest}
      className={cn("font-display-extrabold tracking-tight text-ink", SIZES[size], className)}
    >
      {children}
    </Text>
  );
}
