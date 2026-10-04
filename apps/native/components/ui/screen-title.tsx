import { cn } from "@orrn/ui/lib/utils";
import { Text, type TextProps } from "react-native";

import { TITLE_SIZES } from "@/lib/type-scale";

export type ScreenTitleProps = TextProps & { size?: keyof typeof TITLE_SIZES; className?: string };

/**
 * The C2 display heading (Bricolage Grotesque, tight tracking) for screens
 * that draw their own title. Sizes live in `TITLE_SIZES` (lib/type-scale.ts)
 * with 1.35x line heights, so Devanagari vowel marks above the line are never
 * clipped in Hindi (__tests__/type-scale.test.ts). Dynamic Type may grow the
 * title to 2x (WCAG 1.4.4's 200%; Apple's own large titles stop near 1.8x),
 * past which a 34pt heading would wrap one word per line.
 */
export function ScreenTitle({ size = "lg", className, children, ...rest }: ScreenTitleProps) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={2}
      {...rest}
      className={cn("font-display-extrabold tracking-tight text-ink", TITLE_SIZES[size], className)}
    >
      {children}
    </Text>
  );
}
