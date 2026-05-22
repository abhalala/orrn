import type { ReactNode } from "react";

import { Checkbox as TgCheckbox, Text } from "@orrn/ui/lib/tg";

export type CheckboxProps = Record<string, any> & { children?: ReactNode };

/**
 * Cross-platform Tamagui Checkbox. Uses a Unicode glyph for the indicator so
 * we don't introduce an icon-set dependency just for one component.
 */
export function Checkbox(props: CheckboxProps) {
  return (
    <TgCheckbox
      size="$3"
      borderRadius={4}
      borderColor="$borderColor"
      backgroundColor="$backgroundStrong"
      focusStyle={{ borderColor: "$primary" }}
      {...props}
    >
      <TgCheckbox.Indicator>
        <Text fontSize={12} color="$primaryFg" lineHeight={12}>
          ✓
        </Text>
      </TgCheckbox.Indicator>
    </TgCheckbox>
  );
}
