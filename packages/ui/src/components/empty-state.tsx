import type { ReactNode } from "react";

import { H4, Paragraph, XStack, YStack } from "@orrn/ui/lib/tg";

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  icon?: ReactNode;
};

/**
 * Cross-platform empty placeholder used in lists/tables when there's nothing
 * to show.
 */
export function EmptyState({ title, description, actions, icon }: EmptyStateProps) {
  return (
    <YStack
      alignItems="center"
      justifyContent="center"
      gap={12}
      paddingVertical={32}
      paddingHorizontal={20}
    >
      {icon ? <YStack opacity={0.6}>{icon}</YStack> : null}
      <H4 fontSize={16} fontWeight="600" textAlign="center" margin={0}>
        {title}
      </H4>
      {description ? (
        <Paragraph fontSize={13} color="$mutedFg" textAlign="center" margin={0} maxWidth={420}>
          {description}
        </Paragraph>
      ) : null}
      {actions ? (
        <XStack gap={8} flexWrap="wrap" justifyContent="center">
          {actions}
        </XStack>
      ) : null}
    </YStack>
  );
}
