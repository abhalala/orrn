import type { ReactNode } from "react";

import { H1, Paragraph, XStack, YStack } from "@orrn/ui/lib/tg";

import { PageActions } from "./app-frame";

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
};

/**
 * Standard ORRN page header: eyebrow + title + description on the left,
 * actions slot on the right.
 */
export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <XStack alignItems="flex-start" justifyContent="space-between" gap={12} flexWrap="wrap">
      <YStack gap={4} flex={1} minWidth={0}>
        {eyebrow ? (
          <Paragraph
            fontSize={11}
            color="$mutedFg"
            textTransform="uppercase"
            letterSpacing={0.6}
            margin={0}
          >
            {eyebrow}
          </Paragraph>
        ) : null}
        <H1
          className="orrn-page-title"
          fontSize={24}
          fontWeight="650"
          color="$color"
          margin={0}
          lineHeight={30}
        >
          {title}
        </H1>
        {description ? (
          <Paragraph className="orrn-page-description" fontSize={13} color="$mutedFg" margin={0} maxWidth={680}>
            {description}
          </Paragraph>
        ) : null}
      </YStack>
      {actions ? <PageActions>{actions}</PageActions> : null}
    </XStack>
  );
}
