import type { ReactNode } from "react";

import { XStack, YStack } from "@orrn/ui/lib/tg";

export type ToolbarProps = Record<string, any> & {
  children?: ReactNode;
  actions?: ReactNode;
};

/**
 * Horizontal toolbar used at the top of list screens (search + filters on the
 * left, action buttons on the right). Wraps gracefully on narrow viewports.
 */
export function Toolbar({ children, actions, ...rest }: ToolbarProps) {
  return (
    <YStack gap={12}>
      <XStack alignItems="center" gap={12} flexWrap="wrap" {...rest}>
        <XStack alignItems="center" gap={8} flexWrap="wrap" flex={1} minWidth={200}>
          {children}
        </XStack>
        {actions ? (
          <XStack alignItems="center" gap={8} flexWrap="wrap">
            {actions}
          </XStack>
        ) : null}
      </XStack>
    </YStack>
  );
}
